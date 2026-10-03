# VULCANO — Tienda online (Flask + PostgreSQL)

Página de presentación de productos con estética **Apple España** (dark showroom) y módulo de shop completo con dos tipos de usuario: **cliente** (compra) y **admin** (gestión de catálogo, clientes y pedidos).

![Stack](https://img.shields.io/badge/backend-Flask%20%2B%20PostgreSQL-blue) ![Front](https://img.shields.io/badge/front-vanilla%20JS-orange)

---

## Características

- **Showcase** tipo Apple: hero a pantalla completa con `VULCANO.gif`, logo corporativo, ritmo oscuro → oscuro → claro, tipografía con tracking negativo, CTA azul único, sin sombras.
- **Shop**: listado con filtros por categoría, ficha de producto, carrito (localStorage), checkout con dirección y método de pago.
- **Auth por sesión** (cookie de Flask): dos roles.
  - **Admin**: CRUD de productos (con subida de imagen a `/uploads/`), gestión de clientes, cambio de estado de pedidos, panel de estadísticas.
  - **Cliente**: registro, compra, historial de pedidos.
- **API REST** JSON en `/api/*`.
- Datos persistidos en **PostgreSQL** con integridad referencial:
  `orders.user_id → users.id`, `order_items.order_id → orders.id` (CASCADE),
  `order_items.product_id → products.id` (ver `migrate.py`).

## Requisitos

- Python 3.10+
- PostgreSQL 12+
- pip

## Instalación

### 1. Crear la base de datos

```bash
sudo -u postgres psql
```

```sql
CREATE USER vulcano WITH PASSWORD 'vulcano';
CREATE DATABASE vulcano OWNER vulcano;
\q
```

### 2. Clonar e instalar dependencias

```bash
git clone https://github.com/Zelaya02/VulcanoPagePy.git
cd VulcanoPagePy
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` (ajunta usuario/contraseña/host de tu PostgreSQL):

```
DATABASE_URL=postgresql://vulcano:vulcano@localhost:5432/vulcano
FLASK_SECRET=un-valor-seguro-y-largo
FLASK_DEBUG=1
PORT=5000
```

> Si prefieres variables sueltas en lugar de `DATABASE_URL`, usa `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.

### 4. Ejecutar

```bash
python app.py
```

Abre **http://localhost:5000**

En el primer arranque se crean las tablas y se insertan datos semilla (productos de muestra + 2 usuarios).

> **BD ya existente (sin FKs):** ejecuta una vez la migración (idempotente) para
> añadir `orders.user_id`, la tabla `order_items` y las claves foráneas —
> conserva los datos y mueve el antiguo JSONB `orders.items` a `order_items`:
> ```bash
> python migrate.py
> ```

## Usuarios demo

| Rol | Email | Contraseña |
|-----|-------|------------|
| Admin | `admin@vulcano.es` | `admin1234` |
| Cliente | `cliente@vulcano.es` | `cliente1234` |

> **Cámbialas** desde el editor o con SQL en cuanto termines la demo:
> ```sql
> -- requiere: pip install werkzeug (ya incluido con Flask)
> -- la contraseña se almacena hashada con werkzeug
> ```

## Estructura del proyecto

```
VulcanoPagePy/
├── app.py                  # App Flask + API REST
├── db.py                   # Conexión, schema y datos semilla
├── migrate.py              # Migración idempotente: añade las FKs a una BD existente
├── requirements.txt
├── .env.example            # Plantilla de configuración
├── README.md
└── static/                 # Frontend (servido desde /)
    ├── index.html
    ├── css/styles.css      # Sistema de diseño Apple
    ├── js/app.js           # SPA con hash routing + fetch a /api
    ├── simbolo vulcano 1.png
    ├── VULCANO.gif
    └── uploads/            # Imágenes subidas por el admin
```

## Esquema de la base de datos

```
users(id PK, name, email UNIQUE, password_hash, role, created_at)
products(id PK, name, cat, price, badge, art, img, desc, specs JSONB)
orders(id PK, code UNIQUE, user_id FK→users, email, name, total,
       address JSONB, payment, status, created_at)
order_items(id PK, order_id FK→orders ON DELETE CASCADE,
            product_id FK→products ON DELETE RESTRICT,
            name snapshot, unit_price snapshot, qty)
```

Reglas de integridad:

- No se puede eliminar un **producto** que aparezca en pedidos (la API devuelve `409`).
- No se puede eliminar un **cliente** que tenga pedidos (`409`).
- Al eliminar un **pedido** se borran sus líneas automáticamente (CASCADE).
- El `name`/`unit_price` de cada línea es una foto del momento de compra: aunque el producto cambie de precio después, el pedido conserva el original.

## API

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/register` | — | Registrar cliente (`name`, `email`, `password`) |
| `POST` | `/api/login` | — | Login (`email`, `password`, `expected_role` opcional) |
| `POST` | `/api/logout` | — | Cerrar sesión |
| `GET` | `/api/me` | cookie | Usuario actual |
| `GET` | `/api/products` | — | Listado (`?cat=` opcional) |
| `GET` | `/api/products/:id` | — | Detalle |
| `POST` | `/api/products` | admin | Crear producto |
| `PUT` | `/api/products/:id` | admin | Actualizar producto |
| `DELETE` | `/api/products/:id` | admin | Eliminar producto |
| `POST` | `/api/upload` | admin | Subir imagen (multipart `file`) → `{url}` |
| `GET` | `/api/orders` | login | Pedidos (todos para admin, propios para cliente) |
| `POST` | `/api/orders` | cliente | Crear pedido (`items`, `address`, `payment`); el total se calcula en servidor |
| `PATCH` | `/api/orders/:id/status` | admin | Cambiar estado (`Pendiente`/`Enviado`/`Entregado`) |
| `GET` | `/api/customers` | admin | Listado de usuarios |
| `DELETE` | `/api/customers/:id` | admin | Eliminar cliente (protege admins y al propio usuario) |
| `GET` | `/api/stats` | admin | Conteos e ingresos |

## Notas de seguridad

- Las contraseñas se almacenan **hasheadas** (werkzeug/pbkdf2).
- El precio y el stock se validan **en servidor** al crear el pedido.
- En producción: usa `FLASK_SECRET` fuerte, HTTPS, un usuario de PostgreSQL con mínimos privilegios y desactiva `FLASK_DEBUG`.
- Este es un proyecto demo/educativo: no incluye pasarela de pago real ni gestión de stock transaccional.

## Licencia

MIT — demo con fines de presentación.
