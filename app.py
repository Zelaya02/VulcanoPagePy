"""VULCANO — Backend con Flask + PostgreSQL.

API REST para la tienda: autenticación por sesión, productos,
pedidos, clientes y subida de imágenes. El frontend estático
se sirve desde /static.
"""
import os
import uuid
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory, session
from psycopg2 import IntegrityError
from psycopg2.extras import Json
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from db import connect, dict_rows, init_db, sane

load_dotenv()

app = Flask(__name__, static_folder='static', static_url_path='')
app.secret_key = os.environ.get('FLASK_SECRET', 'cambia-esto-en-produccion')
app.config['MAX_CONTENT_LENGTH'] = 8 * 1024 * 1024  # 8 MB por subida

ALLOWED_EXT = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'}
UPLOAD_DIR = os.path.join(app.static_folder, 'uploads')
ORDER_STATUS = ['Pendiente', 'Enviado', 'Entregado']


# ---------------- Utilidades de autenticación ----------------

def current_user():
    uid = session.get('user_id')
    if not uid:
        return None
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT id, name, email, role, created_at FROM users WHERE id = %s',
                (uid,))
            rows = dict_rows(cur)
    finally:
        conn.close()
    return sane(rows[0]) if rows else None


def login_required(f):
    @wraps(f)
    def wrap(*args, **kwargs):
        if not session.get('user_id'):
            return jsonify({'error': 'No has iniciado sesión'}), 401
        return f(*args, **kwargs)
    return wrap


def admin_required(f):
    @wraps(f)
    def wrap(*args, **kwargs):
        u = current_user()
        if not u:
            return jsonify({'error': 'No has iniciado sesión'}), 401
        if u['role'] != 'admin':
            return jsonify({'error': 'Se requiere rol de administrador'}), 403
        return f(*args, **kwargs)
    return wrap


def attach_items(cur, orders):
    """Adjunta a cada pedido sus líneas (order_items) con la forma que espera el front."""
    if not orders:
        return orders
    cur.execute(
        'SELECT order_id, product_id, name, unit_price, qty FROM order_items '
        'WHERE order_id = ANY(%s) ORDER BY order_id, id',
        ([o['id'] for o in orders],))
    by_order = {}
    for oid, pid, name, price, qty in cur.fetchall():
        by_order.setdefault(oid, []).append(
            {'id': pid, 'name': name, 'price': float(price), 'qty': qty})
    for o in orders:
        o['items'] = by_order.get(o['id'], [])
    return orders


def authenticate_request():
    """Valida email/password y rol esperado. Devuelve (user, error_response)."""
    data = request.get_json(silent=True) or {}
    email = str(data.get('email', '')).strip().lower()
    password = str(data.get('password', ''))
    if not email or not password:
        return None, (jsonify({'error': 'Email y contraseña obligatorios'}), 400)
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT id, name, email, password_hash, role FROM users WHERE LOWER(email) = %s',
                (email,))
            rows = dict_rows(cur)
    finally:
        conn.close()
    if not rows or not check_password_hash(rows[0]['password_hash'], password):
        return None, (jsonify({'error': 'Email o contraseña incorrectos'}), 401)
    user = {k: rows[0][k] for k in ('id', 'name', 'email', 'role')}
    expected = str(data.get('expected_role', '')).strip().lower()
    if expected and expected != user['role']:
        return None, (jsonify({'error': 'Este usuario no tiene ese rol'}), 403)
    return user, None


# ---------------- Frontend ----------------

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


# ---------------- Auth ----------------

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get('name', '')).strip()
    email = str(data.get('email', '')).strip().lower()
    password = str(data.get('password', ''))
    if not name or not email or len(password) < 4:
        return jsonify({'error': 'Nombre, email válido y contraseña de mínimo 4 caracteres'}), 400
    conn = connect()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    'INSERT INTO users (name, email, password_hash, role)'
                    ' VALUES (%s, %s, %s, %s) RETURNING id, name, email, role',
                    (name, email, generate_password_hash(password), 'customer'))
                row = dict_rows(cur)[0]
            except IntegrityError:
                conn.rollback()
                return jsonify({'error': 'Este email ya está registrado'}), 409
            conn.commit()
    finally:
        conn.close()
    session['user_id'] = row['id']
    return jsonify({'user': sane(row)})


@app.route('/api/login', methods=['POST'])
def login():
    user, err = authenticate_request()
    if err:
        return err
    session['user_id'] = user['id']
    return jsonify({'user': user})


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/me')
def me():
    u = current_user()
    if not u:
        return jsonify({'error': 'No autenticado'}), 401
    return jsonify({'user': u})


# ---------------- Productos ----------------

def validate_product(data):
    name = str(data.get('name', '')).strip()
    cat = str(data.get('cat', '')).strip()
    try:
        price = float(data.get('price'))
    except (TypeError, ValueError):
        price = -1
    desc = str(data.get('desc', '')).strip()
    if not name or not cat or price < 0 or not desc:
        return None
    specs = data.get('specs') if isinstance(data.get('specs'), dict) else {}
    return {
        'name': name,
        'cat': cat,
        'price': round(price, 2),
        'badge': str(data.get('badge', '')).strip(),
        'art': str(data.get('art', '')).strip() or 'core',
        'img': str(data.get('img', '')).strip(),
        'desc': desc,
        'specs': specs,
    }


@app.route('/api/products')
def products_list():
    cat = request.args.get('cat', '').strip()
    conn = connect()
    try:
        with conn.cursor() as cur:
            if cat:
                cur.execute('SELECT * FROM products WHERE cat = %s ORDER BY id DESC', (cat,))
            else:
                cur.execute('SELECT * FROM products ORDER BY id DESC')
            rows = dict_rows(cur)
    finally:
        conn.close()
    return jsonify({'products': sane(rows)})


@app.route('/api/products/<int:pid>')
def product_detail(pid):
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT * FROM products WHERE id = %s', (pid,))
            rows = dict_rows(cur)
    finally:
        conn.close()
    if not rows:
        return jsonify({'error': 'Producto no encontrado'}), 404
    return jsonify({'product': sane(rows[0])})


@app.route('/api/products', methods=['POST'])
@admin_required
def product_create():
    data = validate_product(request.get_json(silent=True) or {})
    if not data:
        return jsonify({'error': 'Revisa nombre, categoría, precio y descripción'}), 400
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO products (name, cat, price, badge, art, img, "desc", specs)'
                ' VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *',
                (data['name'], data['cat'], data['price'], data['badge'],
                 data['art'], data['img'], data['desc'], Json(data['specs'])))
            row = dict_rows(cur)[0]
            conn.commit()
    finally:
        conn.close()
    return jsonify({'product': sane(row)})


@app.route('/api/products/<int:pid>', methods=['PUT'])
@admin_required
def product_update(pid):
    data = validate_product(request.get_json(silent=True) or {})
    if not data:
        return jsonify({'error': 'Revisa nombre, categoría, precio y descripción'}), 400
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE products SET name=%s, cat=%s, price=%s, badge=%s, art=%s,'
                ' img=%s, "desc"=%s, specs=%s WHERE id=%s RETURNING *',
                (data['name'], data['cat'], data['price'], data['badge'],
                 data['art'], data['img'], data['desc'], Json(data['specs']), pid))
            rows = dict_rows(cur)
            if not rows:
                conn.rollback()
                return jsonify({'error': 'Producto no encontrado'}), 404
            conn.commit()
    finally:
        conn.close()
    return jsonify({'product': sane(rows[0])})


@app.route('/api/products/<int:pid>', methods=['DELETE'])
@admin_required
def product_delete(pid):
    conn = connect()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute('DELETE FROM products WHERE id = %s RETURNING id', (pid,))
            except IntegrityError:
                conn.rollback()
                return jsonify({'error': 'No se puede eliminar: el producto está en pedidos'}), 409
            if not cur.fetchone():
                conn.rollback()
                return jsonify({'error': 'Producto no encontrado'}), 404
            conn.commit()
    finally:
        conn.close()
    return jsonify({'ok': True})


# ---------------- Imágenes ----------------

@app.route('/api/upload', methods=['POST'])
@admin_required
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'Falta el archivo'}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({'error': 'Archivo vacío'}), 400
    ext = f.filename.rsplit('.', 1)[-1].lower() if '.' in f.filename else ''
    if ext not in ALLOWED_EXT:
        return jsonify({'error': 'Formato no permitido (png, jpg, gif, webp, svg)'}), 400
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = secure_filename(f.filename)
    unique = '%s_%s' % (uuid.uuid4().hex[:12], filename)
    f.save(os.path.join(UPLOAD_DIR, unique))
    return jsonify({'url': '/uploads/%s' % unique})


# ---------------- Pedidos ----------------

@app.route('/api/orders')
@login_required
def orders_list():
    u = current_user()
    conn = connect()
    try:
        with conn.cursor() as cur:
            if u['role'] == 'admin':
                cur.execute('SELECT * FROM orders ORDER BY id DESC')
            else:
                cur.execute(
                    'SELECT * FROM orders WHERE user_id = %s ORDER BY id DESC',
                    (u['id'],))
            rows = attach_items(cur, dict_rows(cur))
    finally:
        conn.close()
    return jsonify({'orders': sane(rows)})


@app.route('/api/orders', methods=['POST'])
@login_required
def order_create():
    u = current_user()
    if u['role'] != 'customer':
        return jsonify({'error': 'Solo los clientes pueden realizar pedidos'}), 403
    data = request.get_json(silent=True) or {}
    items_in = data.get('items') or []
    if not items_in:
        return jsonify({'error': 'El carrito está vacío'}), 400
    address = data.get('address') if isinstance(data.get('address'), dict) else {}
    payment = str(data.get('payment', ''))
    conn = connect()
    try:
        with conn.cursor() as cur:
            total = 0.0
            lines = []
            for it in items_in:
                try:
                    pid = int(it.get('id'))
                    qty = int(it.get('qty'))
                except (TypeError, ValueError, AttributeError):
                    continue
                if qty <= 0:
                    continue
                cur.execute('SELECT id, name, price FROM products WHERE id = %s', (pid,))
                row = cur.fetchone()
                if not row:
                    continue
                price = float(row[2])
                lines.append({'product_id': pid, 'name': row[1], 'price': price, 'qty': qty})
                total += price * qty
            if not lines:
                conn.rollback()
                return jsonify({'error': 'Carrito inválido'}), 400
            cur.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM orders")
            code = 'V-%04d' % cur.fetchone()[0]
            cur.execute(
                'INSERT INTO orders (code, user_id, email, name, total, address, payment)'
                ' VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *',
                (code, u['id'], u['email'], u['name'], round(total, 2),
                 Json(address), payment))
            order = dict_rows(cur)[0]
            for ln in lines:
                cur.execute(
                    'INSERT INTO order_items (order_id, product_id, name, unit_price, qty)'
                    ' VALUES (%s, %s, %s, %s, %s)',
                    (order['id'], ln['product_id'], ln['name'], ln['price'], ln['qty']))
            conn.commit()
            order['items'] = [
                {'id': ln['product_id'], 'name': ln['name'],
                 'price': ln['price'], 'qty': ln['qty']} for ln in lines
            ]
    finally:
        conn.close()
    return jsonify({'order': sane(order)})


@app.route('/api/orders/<int:oid>/status', methods=['PATCH'])
@admin_required
def order_status(oid):
    data = request.get_json(silent=True) or {}
    status = str(data.get('status', '')).strip()
    if status not in ORDER_STATUS:
        return jsonify({'error': 'Estado no válido'}), 400
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE orders SET status = %s WHERE id = %s RETURNING *',
                (status, oid))
            rows = dict_rows(cur)
            if not rows:
                conn.rollback()
                return jsonify({'error': 'Pedido no encontrado'}), 404
            attach_items(cur, rows)
            conn.commit()
    finally:
        conn.close()
    return jsonify({'order': sane(rows[0])})


# ---------------- Clientes (admin) ----------------

@app.route('/api/customers')
@admin_required
def customers_list():
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT id, name, email, role, created_at FROM users ORDER BY id ASC')
            rows = dict_rows(cur)
    finally:
        conn.close()
    return jsonify({'users': sane(rows)})


@app.route('/api/customers/<int:uid>', methods=['DELETE'])
@admin_required
def customer_delete(uid):
    me = current_user()
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT id, role FROM users WHERE id = %s', (uid,))
            rows = dict_rows(cur)
            if not rows:
                return jsonify({'error': 'Usuario no encontrado'}), 404
            if rows[0]['id'] == me['id'] or rows[0]['role'] == 'admin':
                return jsonify({'error': 'No puedes eliminar este usuario'}), 403
            try:
                cur.execute('DELETE FROM users WHERE id = %s', (uid,))
            except IntegrityError:
                conn.rollback()
                return jsonify({'error': 'No se puede eliminar: el cliente tiene pedidos'}), 409
            conn.commit()
    finally:
        conn.close()
    return jsonify({'ok': True})


# ---------------- Estadísticas (admin) ----------------

@app.route('/api/stats')
@admin_required
def stats():
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT COUNT(*) FROM products')
            products = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM users WHERE role = 'customer'")
            customers = cur.fetchone()[0]
            cur.execute('SELECT COUNT(*), COALESCE(SUM(total), 0) FROM orders')
            order_count, revenue = cur.fetchone()
    finally:
        conn.close()
    return jsonify({'stats': sane({
        'products': products,
        'customers': customers,
        'orders': order_count,
        'revenue': float(revenue),
    })})


# ---------------- Errores ----------------

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'No encontrado'}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Error interno del servidor'}), 500


try:
    init_db()
except Exception as exc:  # noqa: BLE001
    print('[warn] No se pudo conectar a la base de datos: %s' % exc)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=port, debug=debug)
