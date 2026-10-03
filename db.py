"""VULCANO — Capa de base de datos (PostgreSQL).

Conexión vía DATABASE_URL o variables PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
Ejecuta el schema y los datos semilla en el primer arranque.
"""
import os
from datetime import date, datetime
from decimal import Decimal

import psycopg2
from psycopg2.extras import Json
from werkzeug.security import generate_password_hash


def get_dsn():
    """Devuelve una DSN de cadena (DATABASE_URL) o un dict de parámetros."""
    url = os.environ.get('DATABASE_URL', '').strip()
    if url:
        return url.replace('postgres://', 'postgresql://', 1)
    return {
        'host': os.environ.get('PGHOST', 'localhost'),
        'port': int(os.environ.get('PGPORT', '5432')),
        'user': os.environ.get('PGUSER', 'vulcano'),
        'password': os.environ.get('PGPASSWORD', 'vulcano'),
        'dbname': os.environ.get('PGDATABASE', 'vulcano'),
    }


def connect():
    dsn = get_dsn()
    if isinstance(dsn, str):
        return psycopg2.connect(dsn)
    return psycopg2.connect(**dsn)


def dict_rows(cur):
    """Convierte el resultado de un cursor en una lista de dicts."""
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def sane(obj):
    """Serializa Decimal/datetime para respuestas JSON."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: sane(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sane(v) for v in obj]
    return obj


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(160) UNIQUE NOT NULL,
    password_hash VARCHAR(200) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    cat VARCHAR(60) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    badge VARCHAR(60) NOT NULL DEFAULT '',
    art VARCHAR(30) NOT NULL DEFAULT 'core',
    img TEXT NOT NULL DEFAULT '',
    "desc" TEXT NOT NULL,
    specs JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    code VARCHAR(24) UNIQUE NOT NULL,
    email VARCHAR(160) NOT NULL,
    name VARCHAR(120) NOT NULL,
    items JSONB NOT NULL,
    total NUMERIC(10,2) NOT NULL,
    address JSONB NOT NULL DEFAULT '{}'::jsonb,
    payment VARCHAR(40) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""

SEED_USERS = [
    ('Admin Vulcano', 'admin@vulcano.es', 'admin1234', 'admin'),
    ('Cliente Demo', 'cliente@vulcano.es', 'cliente1234', 'customer'),
]

SEED_PRODUCTS = [
    dict(
        name='VULCANO CORE', cat='Colección', price=249.00, badge='Nuevo', art='core', img='',
        desc='Esfera de titanio grado 5 con cristal de zafiro y correa de silicona ignífuga. Un objeto forjado para la muñeca que no conoce límites.',
        specs={'Material': 'Titanio grado 5', 'Peso': '58 g', 'Resistencia': 'IP68', 'Batería': '48 h'},
    ),
    dict(
        name='VULCANO PULSE', cat='Accesorios', price=149.00, badge='', art='pulse', img='',
        desc='Pulsera de titanio con cierre magnético de precisión. Ligera, resistente y con un brillo que recuerda a la lava enfriada.',
        specs={'Material': 'Titanio anodizado', 'Peso': '24 g', 'Resistencia': 'IP68', 'Cierre': 'Magnético'},
    ),
    dict(
        name='VULCANO FORGE', cat='Accesorios', price=89.00, badge='', art='forge', img='',
        desc='Carga rápida de 65 W en un bloque de aluminio negro. Compacto, silencioso y con una sola luz que arde naranja.',
        specs={'Potencia': '65 W', 'Puerto': 'USB-C', 'Entrada': '100–240 V', 'Peso': '96 g'},
    ),
    dict(
        name='VULCANO EMBER', cat='Edición limitada', price=49.00, badge='Edición limitada', art='ember', img='',
        desc='Llavero forjado en acero con acabado volcánico. Serie numerada de 500 unidades, cada una marcada a mano.',
        specs={'Material': 'Acero forjado', 'Serie': '1 / 500', 'Peso': '18 g', 'Acabado': 'Negro volcánico'},
    ),
]


def init_db():
    """Crea tablas si no existen e inserta datos semilla solo la primera vez."""
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            cur.execute('SELECT COUNT(*) FROM users')
            if cur.fetchone()[0] == 0:
                for name, email, password, role in SEED_USERS:
                    cur.execute(
                        'INSERT INTO users (name, email, password_hash, role) VALUES (%s, %s, %s, %s)',
                        (name, email, generate_password_hash(password), role))
            cur.execute('SELECT COUNT(*) FROM products')
            if cur.fetchone()[0] == 0:
                for p in SEED_PRODUCTS:
                    cur.execute(
                        'INSERT INTO products (name, cat, price, badge, art, img, "desc", specs)'
                        ' VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
                        (p['name'], p['cat'], p['price'], p['badge'], p['art'],
                         p['img'], p['desc'], Json(p['specs'])))
            conn.commit()
    finally:
        conn.close()
