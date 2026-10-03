"""VULCANO — Migración: añade las FKs a una BD existente.

- orders.user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
- order_items(order_id FK->orders ON DELETE CASCADE,
              product_id FK->products ON DELETE RESTRICT)
- Migra el JSONB orders.items a order_items y elimina la columna.

Idempotente: puede ejecutarse varias veces sin daño.
Uso:  python migrate.py
"""
import sys

from db import connect


def table_exists(cur, table):
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_name = %s", (table,))
    return cur.fetchone() is not None


def column_exists(cur, table, column):
    cur.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name = %s AND column_name = %s",
        (table, column))
    return cur.fetchone() is not None


def constraint_exists(cur, name):
    cur.execute("SELECT 1 FROM pg_constraint WHERE conname = %s", (name,))
    return cur.fetchone() is not None


def fk_on_column(cur, table, column, reftable):
    """True si ya existe alguna FK (con cualquier nombre) de table.column -> reftable."""
    cur.execute(
        "SELECT 1 FROM pg_constraint c "
        "JOIN LATERAL (SELECT array_agg(a.attname) AS cols FROM pg_attribute a "
        "WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) k ON true "
                "WHERE c.contype = 'f' AND c.conrelid = to_regclass(%s) "
                "AND c.confrelid = to_regclass(%s) AND k.cols = ARRAY[%s]::name[]",
        (table, reftable, column))
    return cur.fetchone() is not None


def column_nullable(cur, table, column):
    cur.execute(
        "SELECT is_nullable FROM information_schema.columns "
        "WHERE table_name = %s AND column_name = %s", (table, column))
    row = cur.fetchone()
    return row is not None and row[0] == 'YES'


def log(msg):
    print('[migrate] %s' % msg)


def migrate():
    conn = connect()
    try:
        with conn.cursor() as cur:
            if not table_exists(cur, 'orders'):
                log('no existe la tabla orders: nada que migrar (init_db creará el schema final)')
                return

            # 1. Columna orders.user_id
            if not column_exists(cur, 'orders', 'user_id'):
                log('añadiendo columna orders.user_id ...')
                cur.execute('ALTER TABLE orders ADD COLUMN user_id INTEGER')
            else:
                log('columna orders.user_id ya existe')

            # 2. Backfill desde users por email
            cur.execute(
                "UPDATE orders o SET user_id = u.id FROM users u "
                "WHERE o.user_id IS NULL AND LOWER(u.email) = LOWER(o.email)")
            log('pedidos vinculados a usuarios: %d' % cur.rowcount)

            # 3. Abort si hay huérfanos (no se puede crear la FK)
            cur.execute("SELECT code, email FROM orders WHERE user_id IS NULL")
            orphans = cur.fetchall()
            if orphans:
                raise SystemExit(
                    'ABORTO: hay %d pedido(s) sin usuario (email no registrado): %s. '
                    'Regístralos o elimínalos antes de migrar.'
                    % (len(orphans), orphans))

            # 4. NOT NULL + FK orders -> users
            if column_nullable(cur, 'orders', 'user_id'):
                log('orders.user_id -> NOT NULL')
                cur.execute('ALTER TABLE orders ALTER COLUMN user_id SET NOT NULL')
            if not constraint_exists(cur, 'fk_orders_user') \
                    and not fk_on_column(cur, 'orders', 'user_id', 'users'):
                log('creando FK fk_orders_user (orders.user_id -> users.id) ...')
                cur.execute(
                    'ALTER TABLE orders ADD CONSTRAINT fk_orders_user '
                    'FOREIGN KEY (user_id) REFERENCES users(id) '
                    'ON UPDATE CASCADE ON DELETE RESTRICT')
            else:
                log('FK orders.user_id -> users.id ya existe')

            # 5. Tabla order_items (sin FKs inline para nombrarlas después)
            if not table_exists(cur, 'order_items'):
                log('creando tabla order_items ...')
                cur.execute(
                    'CREATE TABLE order_items ('
                    ' id SERIAL PRIMARY KEY,'
                    ' order_id INTEGER NOT NULL,'
                    ' product_id INTEGER NOT NULL,'
                    ' name VARCHAR(160) NOT NULL,'
                    ' unit_price NUMERIC(10,2) NOT NULL,'
                    ' qty INTEGER NOT NULL CHECK (qty > 0))')
            else:
                log('tabla order_items ya existe')

            # 6. Backfill order_items desde el JSONB orders.items
            if column_exists(cur, 'orders', 'items'):
                cur.execute(
                    "INSERT INTO order_items (order_id, product_id, name, unit_price, qty) "
                    "SELECT o.id, (it->>'id')::int, it->>'name', "
                    " (it->>'price')::numeric, (it->>'qty')::int "
                    "FROM orders o, jsonb_array_elements(o.items) AS it "
                    "WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)")
                if cur.rowcount:
                    log('líneas migradas a order_items: %d' % cur.rowcount)
                else:
                    log('nada que migrar a order_items')
            else:
                log('columna orders.items ya eliminada: nada que migrar')

            # 7. FKs de order_items + índice
            if not constraint_exists(cur, 'fk_order_items_order') \
                    and not fk_on_column(cur, 'order_items', 'order_id', 'orders'):
                log('creando FK fk_order_items_order (order_items.order_id -> orders.id) ...')
                cur.execute(
                    'ALTER TABLE order_items ADD CONSTRAINT fk_order_items_order '
                    'FOREIGN KEY (order_id) REFERENCES orders(id) '
                    'ON UPDATE CASCADE ON DELETE CASCADE')
            else:
                log('FK order_items.order_id -> orders.id ya existe')
            if not constraint_exists(cur, 'fk_order_items_product') \
                    and not fk_on_column(cur, 'order_items', 'product_id', 'products'):
                log('creando FK fk_order_items_product (order_items.product_id -> products.id) ...')
                cur.execute(
                    'ALTER TABLE order_items ADD CONSTRAINT fk_order_items_product '
                    'FOREIGN KEY (product_id) REFERENCES products(id) '
                    'ON UPDATE CASCADE ON DELETE RESTRICT')
            else:
                log('FK order_items.product_id -> products.id ya existe')
            cur.execute('CREATE INDEX IF NOT EXISTS ix_order_items_order ON order_items(order_id)')
            log('índice ix_order_items_order OK')

            # 8. Verificación: las FKs validan los datos existentes
            expected = [('orders', 'user_id', 'users'),
                        ('order_items', 'order_id', 'orders'),
                        ('order_items', 'product_id', 'products')]
            for table, column, reftable in expected:
                if not fk_on_column(cur, table, column, reftable):
                    raise SystemExit(
                        'ABORTO: falta la FK %s.%s -> %s' % (table, column, reftable))
            log('las 3 FKs existen y están validadas')

            # 9. Eliminar la columna JSONB redundante (ya migrada)
            if column_exists(cur, 'orders', 'items'):
                log('eliminando columna redundante orders.items ...')
                cur.execute('ALTER TABLE orders DROP COLUMN items')

            conn.commit()
            log('migración completada')
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    try:
        migrate()
    except SystemExit as e:
        print('[migrate] %s' % e)
        sys.exit(1)
