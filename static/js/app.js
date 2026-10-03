/* ============================================================
   VULCANO — Front-end con backend Flask + PostgreSQL
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Utilidades ---------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
  const fmtDate = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (e) { return String(iso); }
  };

  /* ---------- Capa de API ---------- */
  async function api(path, opts = {}) {
    const headers = {};
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch('/api' + path, Object.assign({}, opts, { headers }));
    let data = null;
    try { data = await res.json(); } catch (e) { /* sin body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || ('Error ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------- SVG art (placeholders — el admin puede sustituirlos por fotos) ---------- */
  function svgArt(kind) {
    const W = 'fill="none" stroke="#f5f5f7" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"';
    const F = 'fill="#f5f5f7"';
    let inner = '';
    if (kind === 'core') {
      inner = `
        <rect x="168" y="26" width="64" height="120" rx="32" ${W}/>
        <rect x="168" y="254" width="64" height="120" rx="32" ${W}/>
        <circle cx="200" cy="200" r="88" ${W}/>
        <circle cx="200" cy="200" r="62" ${W} stroke-width="4"/>
        <path d="M200 200 L200 152 M200 200 L236 216" ${W} stroke-width="5"/>
        <path d="M200 104 v14 M200 282 v14 M104 200 h14 M282 200 h14" ${W} stroke-width="4"/>`;
    } else if (kind === 'pulse') {
      inner = `
        <path d="M200 96 C 312 96, 328 190, 200 304 C 72 190, 88 96, 200 96 Z" ${W}/>
        <circle cx="200" cy="200" r="26" ${W}/>
        <path d="M200 174 v52 M174 200 h52" ${W} stroke-width="4"/>`;
    } else if (kind === 'forge') {
      inner = `
        <rect x="128" y="128" width="144" height="144" rx="38" ${W}/>
        <path d="M214 154 L176 214 L201 214 L186 252 L228 196 L203 196 Z" ${F}/>`;
    } else if (kind === 'ember') {
      inner = `
        <path d="M200 84 C 238 138, 268 168, 268 218 a68 68 0 1 1 -136 0 C 132 168, 162 138, 200 84 Z" ${W}/>
        <path d="M200 168 C 216 190, 226 202, 226 222 a26 26 0 1 1 -52 0 C 174 202, 184 190, 200 168 Z" ${W} stroke-width="4"/>`;
    } else { /* volcano */
      inner = `
        <circle cx="200" cy="200" r="128" ${W} stroke-width="4"/>
        <path d="M142 268 L188 158 L212 158 L258 268 Z" ${W}/>
        <path d="M188 158 L200 132 L212 158" ${W}/>
        <path d="M191 120 v-16 M200 126 v-20 M209 120 v-16" ${W} stroke-width="4"/>
        <path d="M158 236 h20 M222 236 h20" ${W} stroke-width="4"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#1d1d1f"/>${inner}</svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  /* ---------- Estado ---------- */
  const CART_KEY = 'vulcano_cart';
  let products = [];
  let user = null;
  let cart = {};
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; } catch (e) { cart = {}; }
  let shopFilter = 'Todos';
  let loginTab = 'customer';

  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} };
  const findProduct = (id) => products.find((p) => p.id === Number(id));
  const productImage = (p) => (p.img && p.img.trim() ? p.img.trim() : svgArt(p.art || 'volcano'));
  const cartItems = () => Object.entries(cart).map(([id, q]) => ({ p: findProduct(id), q })).filter((x) => x.p);
  const cartTotal = () => cartItems().reduce((a, x) => a + x.p.price * x.q, 0);

  async function loadProducts() {
    try {
      const d = await api('/products');
      products = d.products || [];
    } catch (e) {
      products = [];
      toast('No se pudo conectar con el servidor');
    }
  }

  /* ---------- Iconos ---------- */
  const IC = {
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M15 18l-6-6 6-6"/></svg>'
  };

  /* ---------- Toast ---------- */
  function toast(msg) {
    const zone = $('#toast-zone');
    if (!zone) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    zone.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  /* ---------- Navegación ---------- */
  function updateNav() {
    const count = Object.values(cart).reduce((a, b) => a + b, 0);
    const badge = $('#cart-badge');
    if (badge) { badge.hidden = count === 0; badge.textContent = count; }
    const link = $('#nav-user');
    if (link) {
      if (user) {
        link.textContent = user.name.split(' ')[0];
        link.setAttribute('href', user.role === 'admin' ? '#/admin' : '#/account');
      } else {
        link.textContent = 'Entrar';
        link.setAttribute('href', '#/login');
      }
    }
    const hash = location.hash.replace(/^#/, '');
    const map = { '/': 'home', '/shop': 'shop', '/account': 'account', '/login': 'login' };
    $$('.nav-links a').forEach((a) => a.classList.remove('active'));
    const key = map[hash] !== undefined ? map[hash] : (hash.startsWith('/product') ? 'shop' : null);
    if (key) { const a = $(`.nav-links a[data-nav="${key}"]`); if (a) a.classList.add('active'); }
  }

  /* ============================================================
     VISTAS
     ============================================================ */

  function viewHome() {
    return `
    <section class="hero">
      <div class="hero-media"><img src="VULCANO.gif" alt="Animación de producto Vulcano"></div>
      <div class="hero-content">
        <div class="container">
          <div class="hero-eyebrow">
            <a class="logo-chip" href="#/"><img src="simbolo%20vulcano%201.png" alt="Vulcano"></a>
            <span>Nueva colección</span>
          </div>
          <h1 class="t-hero on-dark">Fuego en su forma<br>más pura.</h1>
          <p class="hero-sub">Diseño volcánico en titanio y acero forjado. Una edición pensada para quienes no piden permiso.</p>
          <div class="hero-cta">
            <span class="ghost-price">Desde <span class="num">49&nbsp;€</span></span>
            <a class="btn btn-primary" href="#/shop">Comprar</a>
          </div>
        </div>
      </div>
    </section>

    <section class="section-headline bg-black">
      <div class="container">
        <h2 class="t-display on-dark">Una fuerza<br>de la naturaleza.</h2>
      </div>
    </section>

    <section class="section bg-black">
      <div class="container">
        <div class="media-card" style="height:clamp(360px,62vh,640px)">
          <img src="VULCANO.gif" alt="Colección Vulcano en movimiento" style="object-fit:cover">
          <div class="card-overlay">
            <div class="t-eyebrow">Colección</div>
            <h3 class="t-heading-lg on-dark">Forjado en la oscuridad.</h3>
            <p>Acabados que capturan la luz como la lava captura el cielo. Cada pieza se trabaja a mano sobre negro puro.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="section bg-obsidian">
      <div class="container">
        <div class="media-card" style="height:clamp(320px,52vh,560px); background:#000">
          <img src="${svgArt('volcano')}" alt="Símbolo volcánico de Vulcano" style="object-fit:contain; background:#000">
          <div class="card-overlay">
            <div class="t-eyebrow">Edición limitada</div>
            <h3 class="t-heading-lg on-dark">Solo 500 unidades.</h3>
            <p>Numeradas, firmadas y guardadas en estuche de obsidian. Cuando arde la última, no se repite.</p>
            <a class="link-dark" href="#/shop" style="display:inline-flex; align-items:center; gap:6px; margin-top:16px; font-size:17px">Descubrir la edición <span style="width:16px;height:16px;display:inline-block">${IC.arrow}</span></a>
          </div>
        </div>
      </div>
    </section>

    <section class="section bg-white">
      <div class="container split">
        <div class="media-edge">
          <img src="${svgArt('volcano')}" alt="Detalle del diseño Vulcano">
        </div>
        <div>
          <div class="eyebrow-orange">Precisión</div>
          <h2 class="t-display on-light">Hecho para durar.</h2>
          <p class="t-body-17 muted-light" style="margin-top:20px; max-width:460px">
            Titanio grado 5, acero forjado y cristal de zafiro. Materiales que no negocian, ensamblados con tolerancias de relojería.
          </p>
          <div class="inline-feature">
            <span class="icon-ring">${IC.arrow}</span>
            <span>Resistencia IP68 certificada</span>
          </div>
          <div class="inline-feature">
            <span class="icon-ring">${IC.arrow}</span>
            <span>Batería de hasta 48 horas</span>
          </div>
          <div class="stat-strip">
            <div class="stat"><div class="stat-num">48<span style="font-size:17px">h</span></div><div class="stat-label">Batería</div></div>
            <div class="stat"><div class="stat-num">58<span style="font-size:17px">g</span></div><div class="stat-label">Peso</div></div>
            <div class="stat"><div class="stat-num">IP68</div><div class="stat-label">Resistencia</div></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section bg-black">
      <div class="container">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; gap:32px; flex-wrap:wrap">
          <div>
            <div class="eyebrow-orange">Tienda</div>
            <h2 class="t-display on-dark">Elige tu Vulcano.</h2>
          </div>
          <div class="hero-cta">
            <span class="ghost-price">Desde <span class="num">49&nbsp;€</span></span>
            <a class="btn btn-primary" href="#/shop">Ir al Shop</a>
          </div>
        </div>
      </div>
    </section>`;
  }

  function viewShop() {
    const cats = ['Todos', ...new Set(products.map((p) => p.cat))];
    const list = products.filter((p) => shopFilter === 'Todos' || p.cat === shopFilter);
    const count = Object.values(cart).reduce((a, b) => a + b, 0);
    return `
    <section class="bg-black">
      <div class="container page-head">
        <a class="crumb" href="#/">Inicio / </a><span class="crumb" style="color:var(--color-frost-white)">Shop</span>
        <h1 class="t-display on-dark">Shop</h1>
        <p class="t-body-17 muted-dark" style="margin-top:12px">${products.length} productos · Colección Vulcano 2026</p>
        <div class="chip-row" id="chip-row">
          ${cats.map((c) => `<button class="chip ${c === shopFilter ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
          <span style="flex:1"></span>
          ${count ? `<a class="btn btn-primary btn-sm" href="#/cart">Ver carrito (${count})</a>` : ''}
        </div>
        <div id="product-list">
          ${list.length ? list.map(productRow).join('') : `<div class="empty-state"><h3 class="t-heading on-dark">No hay productos en esta categoría.</h3><p>Prueba con otro filtro o vuelve más tarde.</p></div>`}
        </div>
      </div>
    </section>`;
  }

  function productRow(p) {
    return `
    <article class="product-row">
      <a class="product-thumb" href="#/product/${p.id}"><img src="${productImage(p)}" alt="${esc(p.name)}" loading="lazy"></a>
      <div class="product-info">
        <span class="cat-tag">${esc(p.cat)}${p.badge ? `<span class="badge-tag">${esc(p.badge)}</span>` : ''}</span>
        <h3 class="t-heading on-dark"><a href="#/product/${p.id}" style="color:inherit">${esc(p.name)}</a></h3>
        <p>${esc(p.desc)}</p>
      </div>
      <div class="product-side">
        <span class="product-price num">${fmt(p.price)}</span>
        <div class="product-actions">
          <button class="btn btn-graphite btn-sm" data-add="${p.id}">Añadir al carrito</button>
          <a class="link-dark" href="#/product/${p.id}">Ver producto</a>
        </div>
      </div>
    </article>`;
  }

  async function viewProduct(id) {
    let p = findProduct(id);
    if (!p) {
      try {
        const d = await api('/products/' + id);
        p = d.product;
      } catch (e) {
        return `<section class="bg-black"><div class="container empty-state"><h3 class="t-heading on-dark">Producto no encontrado.</h3><p>El artículo que buscas ya no está disponible.</p><a class="btn btn-graphite" href="#/shop">Volver al Shop</a></div></section>`;
      }
    }
    const specRows = Object.entries(p.specs || {}).map(([k, v]) => `<div class="spec-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    return `
    <section class="bg-black">
      <div class="container page-head">
        <a class="crumb" href="#/shop">${IC.back} Shop</a>
        <div class="split" style="grid-template-columns: 1.1fr 1fr; margin-top:24px">
          <div class="media-card" style="height:clamp(320px,56vh,580px)">
            <img src="${productImage(p)}" alt="${esc(p.name)}" style="object-fit:contain">
          </div>
          <div>
            <div class="eyebrow-orange">${esc(p.cat)}${p.badge ? ` · <span style="color:var(--color-halo-blue)">${esc(p.badge)}</span>` : ''}</div>
            <h1 class="t-display on-dark" style="margin:12px 0 20px">${esc(p.name)}</h1>
            <div class="product-price num" style="font-size:24px; margin-bottom:20px">${fmt(p.price)}</div>
            <p class="t-body-17 muted-dark" style="max-width:460px">${esc(p.desc)}</p>
            <dl class="spec-list">${specRows}</dl>
            <div class="hero-cta" style="margin-top:36px">
              <button class="btn btn-primary" data-buy="${p.id}">Comprar ahora</button>
              <button class="btn btn-graphite" data-add="${p.id}">Añadir al carrito</button>
            </div>
            <p class="form-note" style="margin-top:20px">Envío gratuito · Devolución en 30 días · Pago seguro</p>
          </div>
        </div>
      </div>
    </section>`;
  }

  function viewCart() {
    const items = cartItems();
    const subtotal = cartTotal();
    if (!items.length) {
      return `<section class="bg-black"><div class="container page-head"><h1 class="t-display on-dark">Tu carrito</h1>
        <div class="empty-state"><h3 class="t-heading on-dark">Tu carrito está vacío.</h3><p>Explora la colección y encuentra tu próximo Vulcano.</p><a class="btn btn-graphite" href="#/shop">Ir al Shop</a></div></div></section>`;
    }
    return `
    <section class="bg-black">
      <div class="container page-head">
        <h1 class="t-display on-dark">Tu carrito</h1>
        <div class="split" style="grid-template-columns: 1.6fr 1fr; margin-top:24px; align-items:start">
          <div>
            ${items.map(({ p, q }) => `
            <div class="cart-row">
              <a class="cart-thumb" href="#/product/${p.id}"><img src="${productImage(p)}" alt="${esc(p.name)}"></a>
              <div>
                <span class="cat-tag" style="color:var(--color-signal-orange); font-size:12px; font-weight:600">${esc(p.cat)}</span>
                <h3 class="t-heading-sm on-dark"><a href="#/product/${p.id}" style="color:inherit">${esc(p.name)}</a></h3>
                <span class="muted-dark num" style="font-size:14px">${fmt(p.price)} / unidad</span>
              </div>
              <div class="cart-actions">
                <div class="stepper">
                  <button class="step-btn" data-dec="${p.id}" aria-label="Quitar uno">${IC.minus}</button>
                  <span class="step-qty num">${q}</span>
                  <button class="step-btn" data-inc="${p.id}" aria-label="Añadir uno">${IC.plus}</button>
                </div>
                <span class="product-price num" style="min-width:90px; text-align:right">${fmt(p.price * q)}</span>
                <button class="link-dark" data-del="${p.id}" style="font-size:14px">Eliminar</button>
              </div>
            </div>`).join('')}
            <a class="link-dark" href="#/shop" style="display:inline-flex; align-items:center; gap:6px; margin-top:24px; font-size:14px">${IC.back} Seguir comprando</a>
          </div>
          <aside class="summary-card" style="position:sticky; top:110px">
            <h3 class="t-heading-sm on-dark" style="margin-bottom:12px">Resumen</h3>
            <div class="summary-line"><span>Subtotal</span><span class="num">${fmt(subtotal)}</span></div>
            <div class="summary-line"><span>Envío</span><span class="num">Gratis</span></div>
            <div class="summary-line total dark"><span>Total</span><span class="num">${fmt(subtotal)}</span></div>
            <a class="btn btn-primary btn-block" style="margin-top:20px" href="#/checkout">Tramitar pedido</a>
            <p class="form-note" style="text-align:center; margin-top:12px">Pago seguro · IVA incluido</p>
          </aside>
        </div>
      </div>
    </section>`;
  }

  async function viewCheckout() {
    if (!user) { location.hash = '#/login?next=/checkout'; return null; }
    if (user.role !== 'customer') { location.hash = '#/account'; return null; }
    const items = cartItems();
    if (!items.length) { location.hash = '#/cart'; return null; }
    const total = cartTotal();
    return `
    <section class="bg-white">
      <div class="container page-head">
        <h1 class="t-display on-light">Tramitar pedido</h1>
        <div class="split" style="grid-template-columns: 1.5fr 1fr; margin-top:24px; align-items:start">
          <form id="checkout-form" class="card-light" novalidate>
            <h3 class="t-heading-sm on-light" style="margin-bottom:20px">Datos de envío</h3>
            <div class="field"><label for="f-name">Nombre completo</label><input class="input input-light" id="f-name" required value="${esc(user.name)}"></div>
            <div class="field"><label for="f-email">Email</label><input class="input input-light" id="f-email" type="email" required value="${esc(user.email)}"></div>
            <div class="field"><label for="f-addr">Dirección</label><input class="input input-light" id="f-addr" required placeholder="Calle, número, piso"></div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px">
              <div class="field"><label for="f-city">Ciudad</label><input class="input input-light" id="f-city" required></div>
              <div class="field"><label for="f-zip">Código postal</label><input class="input input-light" id="f-zip" required inputmode="numeric"></div>
            </div>
            <div class="field"><label for="f-country">País</label>
              <select class="select select-light" id="f-country">
                <option>España</option><option>Andorra</option><option>Portugal</option><option>Francia</option><option>Alemania</option>
              </select>
            </div>
            <h3 class="t-heading-sm on-light" style="margin:28px 0 16px">Método de pago</h3>
            <div class="radio-row">
              <label class="radio-opt"><input type="radio" name="pay" value="Tarjeta" checked><span>Tarjeta de crédito / débito</span></label>
              <label class="radio-opt"><input type="radio" name="pay" value="Contra reembolso"><span>Contra reembolso</span></label>
              <label class="radio-opt"><input type="radio" name="pay" value="PayPal"><span>PayPal</span></label>
            </div>
            <button class="btn btn-primary btn-block" style="margin-top:32px" type="submit">Realizar pedido · <span class="num">${fmt(total)}</span></button>
          </form>
          <aside class="summary-card-light" style="position:sticky; top:110px">
            <h3 class="t-heading-sm on-light" style="margin-bottom:12px">Tu pedido</h3>
            ${items.map(({ p, q }) => `
              <div class="summary-line"><span>${esc(p.name)} <span class="num" style="color:var(--color-platinum)">× ${q}</span></span><span class="num">${fmt(p.price * q)}</span></div>`).join('')}
            <div class="summary-line"><span>Envío</span><span class="num">Gratis</span></div>
            <div class="summary-line total"><span>Total</span><span class="num">${fmt(total)}</span></div>
          </aside>
        </div>
      </div>
    </section>`;
  }

  function viewLogin(next) {
    if (user) { location.hash = user.role === 'admin' ? '#/admin' : '#/account'; return null; }
    const demoUser = loginTab === 'admin'
      ? '<p class="form-note" style="margin-top:16px">Acceso demo admin · <strong class="num">admin@vulcano.es</strong> / <strong class="num">admin1234</strong></p>'
      : '<p class="form-note" style="margin-top:16px">Acceso demo cliente · <strong class="num">cliente@vulcano.es</strong> / <strong class="num">cliente1234</strong><br>¿Sin cuenta? Rellena el nombre y crea tu cuenta de cliente.</p>';
    const nameField = loginTab === 'customer'
      ? '<div class="field"><label for="l-name">Nombre (para crear cuenta nueva)</label><input class="input" id="l-name" placeholder="Tu nombre"></div>'
      : '';
    return `
    <section class="bg-black">
      <div class="container page-head" style="max-width:480px">
        <h1 class="t-display on-dark" style="margin-bottom:8px">Entrar</h1>
        <p class="t-body-17 muted-dark" style="margin-bottom:32px">Accede a tu cuenta Vulcano para comprar y gestionar tus pedidos.</p>
        <div class="role-tabs" id="role-tabs">
          <button class="role-tab ${loginTab === 'customer' ? 'active' : ''}" data-tab="customer">Cliente</button>
          <button class="role-tab ${loginTab === 'admin' ? 'active' : ''}" data-tab="admin">Admin</button>
        </div>
        <form id="login-form" class="card" novalidate>
          ${nameField}
          <div class="field"><label for="l-email">Email</label><input class="input" id="l-email" type="email" required autocomplete="email"></div>
          <div class="field"><label for="l-pass">Contraseña</label><input class="input" id="l-pass" type="password" required autocomplete="current-password"></div>
          <button class="btn btn-primary btn-block" type="submit">${loginTab === 'admin' ? 'Entrar como Admin' : 'Entrar'}</button>
          <p class="form-note" id="login-error" style="color:var(--color-signal-orange); display:none; margin-top:12px"></p>
          ${demoUser}
        </form>
        ${next ? `<input type="hidden" id="login-next" value="${esc(next)}">` : ''}
      </div>
    </section>`;
  }

  async function viewAccount() {
    if (!user) { location.hash = '#/login'; return null; }
    if (user.role === 'admin') { location.hash = '#/admin'; return null; }
    let orders = [];
    try { const d = await api('/orders'); orders = d.orders || []; }
    catch (e) { toast(e.message); }
    return `
    <section class="bg-black">
      <div class="container page-head">
        <h1 class="t-display on-dark">Hola, ${esc(user.name.split(' ')[0])}.</h1>
        <p class="t-body-17 muted-dark" style="margin-top:12px">${esc(user.email)} · ${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}</p>
        <h2 class="t-heading-lg on-dark" style="margin:48px 0 24px">Mis pedidos</h2>
        ${orders.length ? orders.map((o) => `
          <div class="order-card">
            <div class="order-head">
              <div><span class="t-heading-sm on-dark num">${esc(o.code)}</span><span class="muted-dark" style="margin-left:12px">${fmtDate(o.created_at)}</span></div>
              <span class="role-pill" style="color:${o.status === 'Entregado' ? 'var(--color-reef-teal)' : 'var(--color-signal-orange)'}">${esc(o.status)}</span>
            </div>
            <div class="order-items">
              ${(o.items || []).map((it) => `<div class="order-item"><span>${esc(it.name)} <span style="color:var(--color-platinum)">× ${it.qty}</span></span><span class="num">${fmt(it.price * it.qty)}</span></div>`).join('')}
            </div>
            <div class="summary-line total dark" style="max-width:320px; margin-left:auto"><span>Total</span><span class="num">${fmt(o.total)}</span></div>
          </div>`).join('')
        : `<div class="empty-state"><h3 class="t-heading on-dark">Aún no tienes pedidos.</h3><p>Cuando compres algo, aparecerá aquí.</p><a class="btn btn-graphite" href="#/shop">Ir al Shop</a></div>`}
        <button class="btn btn-outline" id="logout-btn" style="margin-top:32px">Cerrar sesión</button>
      </div>
    </section>`;
  }

  /* ---------- Admin ---------- */
  function guardAdmin() {
    if (!user) { location.hash = '#/login'; return false; }
    if (user.role !== 'admin') { location.hash = '#/account'; return false; }
    return true;
  }

  async function viewAdmin() {
    if (!guardAdmin()) return null;
    let stats = { products: 0, customers: 0, orders: 0, revenue: 0 };
    try { const d = await api('/stats'); stats = d.stats || stats; }
    catch (e) { toast(e.message); }
    return `
    <section class="bg-black">
      <div class="container page-head">
        <h1 class="t-display on-dark">Administración</h1>
        <p class="t-body-17 muted-dark" style="margin-top:12px">Panel de control · Vulcano Store</p>
        <div class="stat-grid">
          <div class="stat-block"><div class="num-big">${stats.products}</div><div class="lbl">Productos activos</div></div>
          <div class="stat-block"><div class="num-big">${stats.customers}</div><div class="lbl">Clientes registrados</div></div>
          <div class="stat-block"><div class="num-big">${stats.orders}</div><div class="lbl">Pedidos · <span style="font-size:17px">${fmt(stats.revenue)}</span></div></div>
        </div>
        <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:48px">
          <a class="btn btn-primary" href="#/admin/product/new">Nuevo producto</a>
          <a class="btn btn-graphite" href="#/admin/orders">Gestionar pedidos</a>
          <a class="btn btn-graphite" href="#/admin/customers">Clientes</a>
        </div>
        <h2 class="t-heading-lg on-dark" style="margin-bottom:24px">Productos</h2>
        <div class="card" style="padding:8px 24px">
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th style="text-align:right">Acciones</th></tr></thead>
            <tbody>
              ${products.map((p) => `
              <tr>
                <td><div class="cell"><span class="thumb-sm"><img src="${productImage(p)}" alt=""></span><span class="on-dark" style="font-weight:600">${esc(p.name)}</span>${p.badge ? `<span style="color:var(--color-halo-blue); font-size:12px; font-weight:600; margin-left:8px">${esc(p.badge)}</span>` : ''}</div></td>
                <td><span style="color:var(--color-signal-orange); font-size:12px; font-weight:600">${esc(p.cat)}</span></td>
                <td class="num" style="color:var(--color-frost-white)">${fmt(p.price)}</td>
                <td><div class="cell-actions" style="justify-content:flex-end">
                  <a class="link-dark" href="#/admin/product/${p.id}">Editar</a>
                  <button class="link-dark" style="color:var(--color-platinum)" data-del-prod="${p.id}">Eliminar</button>
                </div></td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </div>
    </section>`;
  }

  async function viewAdminCustomers() {
    if (!guardAdmin()) return null;
    let users = [];
    try { const d = await api('/customers'); users = d.users || []; }
    catch (e) { toast(e.message); }
    return `
    <section class="bg-black">
      <div class="container page-head">
        <a class="crumb" href="#/admin">${IC.back} Panel</a>
        <h1 class="t-display on-dark">Clientes</h1>
        <p class="t-body-17 muted-dark" style="margin:12px 0 32px">${users.length} cuentas registradas</p>
        <div class="card" style="padding:8px 24px">
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Cliente</th><th>Email</th><th>Rol</th><th>Alta</th><th style="text-align:right">Acciones</th></tr></thead>
            <tbody>
              ${users.map((u) => `
              <tr>
                <td class="on-dark" style="font-weight:600">${esc(u.name)}</td>
                <td class="muted-dark num">${esc(u.email)}</td>
                <td><span class="role-pill ${u.role === 'admin' ? 'role-admin' : 'role-customer'}">${u.role === 'admin' ? 'Admin' : 'Cliente'}</span></td>
                <td class="muted-dark">${fmtDate(u.created_at)}</td>
                <td><div class="cell-actions" style="justify-content:flex-end">
                  ${u.id === user.id || u.role === 'admin'
                    ? `<span class="muted-dark" style="font-size:14px">Protegido</span>`
                    : `<button class="link-dark" style="color:var(--color-platinum)" data-del-user="${u.id}">Eliminar</button>`}
                </div></td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </div>
    </section>`;
  }

  async function viewAdminOrders() {
    if (!guardAdmin()) return null;
    let orders = [];
    try { const d = await api('/orders'); orders = d.orders || []; }
    catch (e) { toast(e.message); }
    return `
    <section class="bg-black">
      <div class="container page-head">
        <a class="crumb" href="#/admin">${IC.back} Panel</a>
        <h1 class="t-display on-dark">Pedidos</h1>
        <p class="t-body-17 muted-dark" style="margin:12px 0 32px">${orders.length} pedidos · <span class="num">${fmt(orders.reduce((a, o) => a + o.total, 0))}</span> facturado</p>
        ${orders.length ? `<div class="card" style="padding:8px 24px"><div class="table-wrap"><table class="table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Productos</th><th>Total</th><th>Fecha</th><th>Estado</th></tr></thead>
          <tbody>
            ${orders.map((o) => `
            <tr>
              <td class="num on-dark" style="font-weight:600">${esc(o.code)}</td>
              <td><div>${esc(o.name)}</div><div class="muted-dark num" style="font-size:12px">${esc(o.email)}</div></td>
              <td class="muted-dark">${(o.items || []).reduce((a, i) => a + i.qty, 0)} ${(o.items || []).reduce((a, i) => a + i.qty, 0) === 1 ? 'artículo' : 'artículos'}</td>
              <td class="num" style="color:var(--color-frost-white)">${fmt(o.total)}</td>
              <td class="muted-dark">${fmtDate(o.created_at)}</td>
              <td><select class="status-select" data-order="${o.id}" data-code="${o.code}">
                ${['Pendiente', 'Enviado', 'Entregado'].map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
              </select></td>
            </tr>`).join('')}
          </tbody>
        </table></div></div>`
        : `<div class="empty-state"><h3 class="t-heading on-dark">Sin pedidos todavía.</h3><p>Los pedidos de los clientes aparecerán aquí.</p></div>`}
      </div>
    </section>`;
  }

  async function viewProductEditor(idParam) {
    if (!guardAdmin()) return null;
    const isNew = idParam === 'new';
    const existing = isNew ? null : findProduct(idParam);
    const p = existing || { name: '', cat: products[0] ? products[0].cat : 'Colección', price: 0, badge: '', art: 'core', img: '', desc: '', specs: { Material: 'Titanio grado 5', Peso: '58 g', Resistencia: 'IP68', Batería: '48 h' } };
    if (idParam !== 'new' && !existing) { location.hash = '#/admin'; return null; }
    const arts = ['core', 'pulse', 'forge', 'ember'];
    const previewSrc = (p.img && p.img.trim()) || svgArt(p.art);
    return `
    <section class="bg-black">
      <div class="container page-head" style="max-width:760px">
        <a class="crumb" href="#/admin">${IC.back} Panel</a>
        <h1 class="t-display on-dark" style="margin-bottom:8px">${isNew ? 'Nuevo producto' : 'Editar producto'}</h1>
        <p class="t-body-17 muted-dark" style="margin-bottom:32px">${isNew ? 'Añade un artículo a la colección Vulcano.' : 'Modifica los datos de ' + esc(p.name) + '.'}</p>
        <form id="product-form" class="card" novalidate>
          <div style="display:grid; grid-template-columns:120px 1fr; gap:24px; margin-bottom:24px">
            <div class="product-thumb" style="width:120px; height:120px"><img id="img-preview" src="${previewSrc}" alt="Vista previa"></div>
            <div>
              <div class="field"><label for="p-img">URL de imagen (vacío = diseño de muestra)</label><input class="input" id="p-img" type="url" placeholder="https://… o /uploads/…" value="${esc(p.img || '')}"></div>
              <div class="field" style="margin-bottom:12px"><label>O sube un archivo</label>
                <div style="display:flex; gap:8px; align-items:center">
                  <button type="button" class="btn btn-graphite btn-sm" id="upload-btn">Subir imagen</button>
                  <input type="file" id="p-file" accept="image/*" hidden>
                  <span class="muted-dark" style="font-size:12px">png, jpg, gif, webp, svg · máx. 8 MB</span>
                </div>
              </div>
              <div class="field" style="margin-bottom:0"><label>Diseños de muestra</label>
                <div style="display:flex; gap:8px" id="art-picker">
                  ${arts.map((a) => `<button type="button" class="step-btn" style="width:48px; height:48px; border-radius:10px; overflow:hidden; ${a === p.art && !p.img ? 'border-color:var(--color-signal-orange)' : ''}" data-art="${a}"><img src="${svgArt(a)}" alt="${a}" style="width:100%; height:100%; object-fit:cover"></button>`).join('')}
                </div>
              </div>
            </div>
          </div>
          <div class="field"><label for="p-name">Nombre</label><input class="input" id="p-name" required value="${esc(p.name)}" placeholder="VULCANO …"></div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px">
            <div class="field"><label for="p-cat">Categoría</label>
              <select class="select" id="p-cat">${['Colección', 'Accesorios', 'Edición limitada'].map((c) => `<option ${c === p.cat ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </div>
            <div class="field"><label for="p-price">Precio (€)</label><input class="input num" id="p-price" type="number" min="0" step="1" required value="${p.price}"></div>
          </div>
          <div class="field"><label for="p-badge">Etiqueta (opcional)</label><input class="input" id="p-badge" value="${esc(p.badge || '')}" placeholder="Nuevo, Edición limitada…"></div>
          <div class="field"><label for="p-desc">Descripción</label><textarea class="textarea" id="p-desc" required>${esc(p.desc)}</textarea></div>
          <div class="field"><label for="p-specs">Especificaciones (una por línea, formato Clave: Valor)</label><textarea class="textarea" id="p-specs" style="min-height:130px">${Object.entries(p.specs || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}</textarea></div>
          <div style="display:flex; gap:12px">
            <button class="btn btn-primary" type="submit">${isNew ? 'Crear producto' : 'Guardar cambios'}</button>
            <a class="btn btn-outline" href="#/admin">Cancelar</a>
          </div>
        </form>
      </div>
    </section>`;
  }

  function errorView(e) {
    return `<section class="bg-black"><div class="container page-head"><div class="empty-state">
      <h3 class="t-heading on-dark">Algo salió mal.</h3>
      <p>${esc(e.message || 'Error de conexión con el servidor')}</p>
      <a class="btn btn-graphite" href="#/">Volver al inicio</a></div></div></section>`;
  }

  /* ============================================================
     ROUTER
     ============================================================ */
  const app = $('#app');

  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, query] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    return { parts, query: new URLSearchParams(query || '') };
  }

  async function render() {
    const { parts, query } = parseRoute();
    const page = parts[0] || '';
    let html = '';
    try {
      if (page === '') html = await viewHome();
      else if (page === 'shop') html = await viewShop();
      else if (page === 'product') html = await viewProduct(parts[1]);
      else if (page === 'cart') html = viewCart();
      else if (page === 'checkout') html = await viewCheckout();
      else if (page === 'login') html = viewLogin(query.get('next') || '');
      else if (page === 'account') html = await viewAccount();
      else if (page === 'admin') {
        if (parts[1] === 'customers') html = await viewAdminCustomers();
        else if (parts[1] === 'orders') html = await viewAdminOrders();
        else if (parts[1] === 'product') html = await viewProductEditor(parts[2] || 'new');
        else html = await viewAdmin();
      }
      else html = await viewHome();
    } catch (e) {
      if (e.status === 401) { user = null; updateNav(); location.hash = '#/login'; return; }
      html = errorView(e);
    }
    if (html === null) return; // redirección en curso
    app.innerHTML = html;
    updateNav();
    bind(page, parts);
    window.scrollTo(0, 0);
  }

  /* ============================================================
     EVENTOS
     ============================================================ */
  function bind(page, parts) {
    /* Shop: filtros */
    $$('#chip-row .chip').forEach((c) => c.addEventListener('click', () => { shopFilter = c.dataset.cat; render(); }));

    /* Carrito */
    $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const p = findProduct(b.dataset.add);
      if (!p) return;
      cart[p.id] = (cart[p.id] || 0) + 1;
      saveCart(); updateNav();
      toast(`${p.name} añadido al carrito`);
    }));
    $$('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const p = findProduct(b.dataset.buy);
      if (!p) return;
      cart[p.id] = (cart[p.id] || 0) + 1;
      saveCart(); updateNav();
      location.hash = '#/cart';
    }));
    $$('[data-inc]').forEach((b) => b.addEventListener('click', () => { cart[b.dataset.inc]++; saveCart(); render(); }));
    $$('[data-dec]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.dec;
      if (cart[id] > 1) cart[id]--; else delete cart[id];
      saveCart(); render();
    }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => { delete cart[b.dataset.del]; saveCart(); render(); }));

    /* Checkout */
    const co = $('#checkout-form');
    if (co) co.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#f-name').value.trim();
      const email = $('#f-email').value.trim();
      const address = {
        addr: $('#f-addr').value.trim(),
        city: $('#f-city').value.trim(),
        zip: $('#f-zip').value.trim(),
        country: $('#f-country').value
      };
      if (!name || !email || !address.addr || !address.city || !address.zip) { toast('Completa todos los campos de envío'); return; }
      const items = cartItems().map(({ p, q }) => ({ id: p.id, qty: q }));
      try {
        const d = await api('/orders', {
          method: 'POST',
          body: { items, address, payment: co.querySelector('input[name="pay"]:checked').value }
        });
        cart = {}; saveCart(); updateNav();
        toast(`Pedido ${d.order.code} realizado · ${fmt(d.order.total)}`);
        location.hash = '#/account';
      } catch (err) { toast(err.message); }
    });

    /* Login */
    $$('#role-tabs .role-tab').forEach((t) => t.addEventListener('click', () => { loginTab = t.dataset.tab; render(); }));
    const lf = $('#login-form');
    if (lf) lf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#login-error');
      err.style.display = 'none';
      const email = $('#l-email').value.trim().toLowerCase();
      const pass = $('#l-pass').value;
      const nameEl = $('#l-name');
      const name = nameEl ? nameEl.value.trim() : '';
      try {
        const d = await api('/login', { method: 'POST', body: { email, password: pass, expected_role: loginTab } });
        user = d.user;
      } catch (e1) {
        if (loginTab === 'customer' && e1.status === 401 && name) {
          try {
            const rd = await api('/register', { method: 'POST', body: { name, email, password: pass } });
            user = rd.user;
            toast('Cuenta creada. ¡Bienvenido!');
          } catch (e2) { err.textContent = e2.message; err.style.display = 'block'; return; }
        } else { err.textContent = e1.message; err.style.display = 'block'; return; }
      }
      toast(`Hola, ${user.name.split(' ')[0]}`);
      const next = $('#login-next') ? $('#login-next').value : '';
      location.hash = next || (user.role === 'admin' ? '#/admin' : '#/account');
    });

    /* Logout */
    const lo = $('#logout-btn');
    if (lo) lo.addEventListener('click', async () => {
      try { await api('/logout', { method: 'POST' }); } catch (e) {}
      user = null; updateNav();
      toast('Sesión cerrada');
      location.hash = '#/';
    });

    /* Admin: productos / clientes / pedidos */
    $$('[data-del-prod]').forEach((b) => b.addEventListener('click', async () => {
      const p = findProduct(b.dataset.delProd);
      if (p && confirm(`¿Eliminar "${p.name}" de la tienda?`)) {
        try {
          await api('/products/' + p.id, { method: 'DELETE' });
          await loadProducts();
          toast('Producto eliminado');
          render();
        } catch (e) { toast(e.message); }
      }
    }));
    $$('[data-del-user]').forEach((b) => b.addEventListener('click', async () => {
      const uid = b.dataset.delUser;
      if (confirm('¿Eliminar esta cuenta de cliente?')) {
        try {
          await api('/customers/' + uid, { method: 'DELETE' });
          toast('Cliente eliminado');
          render();
        } catch (e) { toast(e.message); }
      }
    }));
    $$('[data-order]').forEach((s) => s.addEventListener('change', async () => {
      try {
        await api('/orders/' + s.dataset.order + '/status', { method: 'PATCH', body: { status: s.value } });
        toast(`Pedido ${s.dataset.code} → ${s.value}`);
      } catch (e) { toast(e.message); render(); }
    }));

    /* Editor de producto */
    const pf = $('#product-form');
    if (pf) {
      const idParam = parts[2] || 'new';
      let chosenArt = null;
      const preview = $('#img-preview');
      const urlInput = $('#p-img');

      $$('#art-picker [data-art]').forEach((b) => b.addEventListener('click', () => {
        chosenArt = b.dataset.art;
        urlInput.value = '';
        preview.src = svgArt(chosenArt);
        $$('#art-picker [data-art]').forEach((x) => { x.style.borderColor = x === b ? 'var(--color-signal-orange)' : ''; });
      }));
      urlInput.addEventListener('input', () => { if (urlInput.value.trim()) preview.src = urlInput.value.trim(); });

      const fileInput = $('#p-file');
      $('#upload-btn').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append('file', f);
        try {
          const d = await api('/upload', { method: 'POST', body: fd });
          urlInput.value = d.url;
          preview.src = d.url;
          chosenArt = null;
          $$('#art-picker [data-art]').forEach((x) => { x.style.borderColor = ''; });
          toast('Imagen subida');
        } catch (e) { toast(e.message); }
      });

      pf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $('#p-name').value.trim();
        const price = Number($('#p-price').value);
        const desc = $('#p-desc').value.trim();
        if (!name || isNaN(price) || price < 0 || !desc) { toast('Revisa nombre, precio y descripción'); return; }
        const specs = {};
        $('#p-specs').value.split('\n').forEach((line) => {
          const m = line.split(':');
          if (m.length >= 2 && m[0].trim()) specs[m[0].trim()] = m.slice(1).join(':').trim();
        });
        const body = {
          name,
          cat: $('#p-cat').value,
          price,
          desc,
          badge: $('#p-badge').value.trim(),
          img: urlInput.value.trim(),
          art: chosenArt || (findProduct(idParam) || {}).art || 'core',
          specs
        };
        try {
          if (idParam === 'new') await api('/products', { method: 'POST', body });
          else await api('/products/' + idParam, { method: 'PUT', body });
          await loadProducts();
          toast(idParam === 'new' ? 'Producto creado' : 'Producto actualizado');
          location.hash = '#/admin';
        } catch (err) { toast(err.message); }
      });
    }
  }

  /* ---------- Buscador global ---------- */
  const overlay = $('#search-overlay');
  const sInput = $('#search-input');
  const sResults = $('#search-results');
  function openSearch() { overlay.classList.add('open'); sInput.value = ''; drawSearch(''); setTimeout(() => sInput.focus(), 50); }
  function closeSearch() { overlay.classList.remove('open'); }
  function drawSearch(q) {
    q = q.trim().toLowerCase();
    const hits = products.filter((p) => !q || p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q));
    sResults.innerHTML = q && !hits.length
      ? `<p class="search-empty">Sin resultados para "${esc(q)}".</p>`
      : hits.map((p) => `
        <a class="search-result-row" href="#/product/${p.id}">
          <span class="thumb-sm"><img src="${productImage(p)}" alt=""></span>
          <span style="flex:1"><span class="on-dark" style="font-weight:600">${esc(p.name)}</span><div class="muted-dark" style="font-size:12px">${esc(p.cat)}</div></span>
          <span class="num" style="color:var(--color-frost-white)">${fmt(p.price)}</span>
        </a>`).join('');
    $$('.search-result-row', sResults).forEach((r) => r.addEventListener('click', closeSearch));
  }
  $('#search-btn').addEventListener('click', openSearch);
  $('#search-close').addEventListener('click', closeSearch);
  sInput.addEventListener('input', (e) => drawSearch(e.target.value));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
    if (e.key === '/' && !overlay.classList.contains('open') && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
  });

  /* ---------- Arranque ---------- */
  window.addEventListener('hashchange', render);

  async function boot() {
    try {
      const me = await api('/me');
      user = me.user;
    } catch (e) { user = null; }
    await loadProducts();
    render();
  }
  boot();
})();
