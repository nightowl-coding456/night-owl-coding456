"use strict";

// ============================================================
// EASYSHOP — FULL E-COMMERCE APP  (Part 1 of 2)
// ============================================================

// Use relative URL when served from the same origin (http://localhost:3000),
// fall back to absolute URL for live-server / file:// usage.
const API = (location.protocol === "file:" || location.port === "5500" || location.port === "5501")
  ? "http://localhost:3000/api"
  : `${location.protocol}//${location.hostname}${location.port ? ":"+location.port : ""}/api`;

// ============================================================
// STATE
// ============================================================

let products        = [];
let cart            = JSON.parse(localStorage.getItem("es_cart") || "[]");
let wishlistIds     = new Set();
let wishlistItems   = [];
let currentUser     = null;
let currentSearch   = "";
let currentCategory = "";
let currentSort     = "newest";
let currentPage     = 1;
let totalPages      = 1;
let totalProductCount = 0;
let productRequest  = 0;
let isPlacingOrder  = false;
let appliedCoupon   = null;
let detailProductId = null;
let detailQty       = 1;
let reviewStarVal   = 5;
let suggestionTimer = null;

const PAGE_SIZE = 12;
let visibleCount = PAGE_SIZE;

// ============================================================
// DOM HELPERS
// ============================================================

const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ============================================================
// API HELPER
// ============================================================

async function api(url, options = {}) {
  const token = localStorage.getItem("es_token");
  const headers = {
    "Accept": "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
  return data;
}

function renderRecentlyViewed() {
  const container = $("recentlyViewedGrid");
  if (!container) return;
  const ids = JSON.parse(localStorage.getItem("es_recently_viewed") || "[]");
  const recent = ids.map(id => getProduct(id)).filter(Boolean).slice(0, 4);
  const section = container.closest("section");
  if (!recent.length) {
    if (section) section.style.display = "none";
    return;
  }
  if (section) section.style.removeProperty("display");
  container.innerHTML = recent.map(productCard).join("");
}

function rememberViewed(productId) {
  const ids = JSON.parse(localStorage.getItem("es_recently_viewed") || "[]")
    .filter(id => Number(id) !== Number(productId));
  ids.unshift(Number(productId));
  localStorage.setItem("es_recently_viewed", JSON.stringify(ids.slice(0, 8)));
  renderRecentlyViewed();
}

// ============================================================
// UTILITIES
// ============================================================

function money(v) {
  const n = Number(v);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

async function loadSuggestions(query) {
  const list = $("searchSuggestions");
  if (!list) return;
  clearTimeout(suggestionTimer);
  if (query.length < 2) {
    list.innerHTML = "";
    list.hidden = true;
    return;
  }
  suggestionTimer = setTimeout(async () => {
    try {
      const data = await api(`${API}/products/suggestions?q=${encodeURIComponent(query)}`);
      list.innerHTML = (data.suggestions || []).map(item =>
        `<button type="button" data-suggestion="${esc(item.name)}">
          <strong>${esc(item.name)}</strong><span>${esc(item.category)} · ${money(item.price)}</span>
        </button>`).join("");
      list.hidden = !data.suggestions?.length;
    } catch (error) {
      console.error("loadSuggestions:", error);
      list.hidden = true;
    }
  }, 160);
}

$("searchSuggestions")?.addEventListener("click", event => {
  const button = event.target.closest("[data-suggestion]");
  if (!button) return;
  const input = $("searchInput");
  if (input) input.value = button.dataset.suggestion;
  $("searchSuggestions").hidden = true;
  doSearch();
});

document.addEventListener("click", event => {
  if (!event.target.closest(".search-box")) {
    const list = $("searchSuggestions");
    if (list) list.hidden = true;
  }
});

function esc(v) {
  return String(v ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function effectivePrice(p) {
  const dp = Number(p?.discount_price), rp = Number(p?.price);
  if (p?.discount_price != null && p.discount_price !== "" &&
      Number.isFinite(dp) && Number.isFinite(rp) && dp >= 0 && dp < rp) return dp;
  return Number.isFinite(rp) ? rp : 0;
}

function deliveryCost(m) { return m === "express" ? 12 : m === "pickup" ? 0 : 5; }

function formatMethod(m) {
  return m === "express" ? "Express Delivery" : m === "pickup" ? "Store Pickup" : "Standard Delivery";
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year:"numeric", month:"short", day:"numeric" });
}

function starsHtml(rating) {
  const r = Math.round(Math.min(Number(rating) || 0, 5));
  return "★".repeat(r) + "☆".repeat(5 - r);
}

function saveCart() { localStorage.setItem("es_cart", JSON.stringify(cart)); }

function normalizeCart() {
  if (!Array.isArray(cart)) { cart = []; saveCart(); return; }
  cart = cart
    .map(i => ({ id: Number(i.id), quantity: Number(i.quantity) }))
    .filter(i => Number.isInteger(i.id) && i.id > 0 && i.quantity > 0);
  saveCart();
}

function getCartItem(id) { return cart.find(i => i.id === Number(id)); }
function getProduct(id)  {
  return products.find(p => Number(p.id) === Number(id))
    || wishlistItems.find(p => Number(p.id) === Number(id));
}

function getCartProducts() {
  return cart.map(i => { const p = getProduct(i.id); return p ? { ...p, quantity: i.quantity } : null; })
             .filter(Boolean);
}

function cartSubtotalVal() {
  return getCartProducts().reduce((s, i) => s + effectivePrice(i) * i.quantity, 0);
}

function showMessage(elRef, msg, type) {
  if (!elRef) return;
  elRef.textContent = msg;
  elRef.className = `form-message${type ? " " + type : ""}`;
  elRef.style.display = msg ? "" : "none";
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <div class="skeleton-card">
      <div class="skeleton-img"></div>
      <div class="skeleton-body">
        <div class="skeleton-line skeleton-line--short"></div>
        <div class="skeleton-line skeleton-line--medium"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line skeleton-line--short"></div>
      </div>
    </div>`).join("");
}

// ============================================================
// TOAST
// ============================================================

function toast(message, type = "success", title = "") {
  const c = $("toastContainer");
  if (!c) return;
  const icons = { success:"✅", error:"❌", warning:"⚠️", info:"ℹ️" };
  const t = document.createElement("div");
  t.className = `toast toast--${type}`;
  t.innerHTML = `
    <span class="toast-icon">${icons[type] || "ℹ️"}</span>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${esc(title)}</div>` : ""}
      <div class="toast-msg">${esc(message)}</div>
    </div>`;

  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3500);
}

// ============================================================
// PRODUCTS — LOAD
// ============================================================

async function loadProducts(reset = true) {
  const pg = $("productsGrid"), fg = $("featuredGrid"), ps = $("productStatus");
  const requestId = ++productRequest;
  if (reset && pg) pg.innerHTML = skeletonCards(8);
  if (fg) fg.innerHTML = skeletonCards(4);
  if (ps) ps.textContent = "Loading…";
  if (reset) currentPage = 1;

  try {
    const params = new URLSearchParams({
      search: currentSearch,
      category: currentCategory,
      sort: currentSort,
      page: String(currentPage),
      limit: String(PAGE_SIZE)
    });
    const data = await api(`${API}/products?${params}`);
    if (requestId !== productRequest) return;
    const incoming = Array.isArray(data) ? data : (data.products || []);
    products = reset ? incoming : [...products, ...incoming];
    totalPages = data.pagination?.totalPages || 1;
    totalProductCount = data.pagination?.total ?? products.length;
    syncCart();
    populateCategoryFilter(data.categories);
    renderFeatured();
    renderProducts();
    renderRecentlyViewed();
    renderCart();
    loadWishlist();
  } catch (err) {
    console.error("loadProducts:", err);
    if (ps) ps.textContent = "Could not load products.";
    if (pg) pg.innerHTML = `
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <h3>Could not load products</h3>
        <p>Make sure the server is running on <strong>http://localhost:3000</strong></p>
        <button class="btn btn-primary" onclick="loadProducts()">Try Again</button>
      </div>`;
  }
}

// ============================================================
// CATEGORY FILTER
// ============================================================

function populateCategoryFilter(categories = null) {
  const cf = $("categoryFilter");
  if (!cf) return;
  const cats = categories || [...new Set(products.map(p => String(p.category || "").trim()).filter(Boolean))].sort();
  const cur = cf.value;
  cf.innerHTML = `<option value="">All Categories</option>` +
    cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if (cats.includes(cur)) cf.value = cur;
}

// ============================================================
// FILTER + SORT
// ============================================================

function getFiltered() {
  let r = [...products];
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    r = r.filter(p => [p.name,p.category,p.description,p.brand,p.sku]
      .some(v => String(v||"").toLowerCase().includes(q)));
  }
  if (currentCategory)
    r = r.filter(p => String(p.category||"").toLowerCase() === currentCategory.toLowerCase());

  switch (currentSort) {
    case "price-low":  r.sort((a,b) => effectivePrice(a) - effectivePrice(b)); break;
    case "price-high": r.sort((a,b) => effectivePrice(b) - effectivePrice(a)); break;
    case "name":       r.sort((a,b) => String(a.name||"").localeCompare(String(b.name||""))); break;
    case "rating":     r.sort((a,b) => Number(b.rating||0) - Number(a.rating||0)); break;
    case "oldest":     r.sort((a,b) => Number(a.id) - Number(b.id)); break;
    default:           r.sort((a,b) => Number(b.id) - Number(a.id)); break;
  }
  return r;
}

// ============================================================
// RENDER — FEATURED
// ============================================================

function renderFeatured() {
  const fg = $("featuredGrid");
  if (!fg) return;
  const featured = products.filter(p => p.featured === 1 || p.featured === true);
  const sec = fg.closest("section");
  if (!featured.length) { if (sec) sec.style.display = "none"; return; }
  if (sec) sec.style.removeProperty("display");
  fg.innerHTML = featured.slice(0, 4).map(productCard).join("");
}

// ============================================================
// RENDER — PRODUCTS
// ============================================================

function renderProducts() {
  const pg = $("productsGrid"), ps = $("productStatus"), lmw = $("loadMoreWrap");
  if (!pg) return;
  const filtered = products;
  const total = filtered.length;
  const shownTotal = totalProductCount || total;
  if (ps) ps.textContent = `${shownTotal} product${shownTotal===1?"":"s"} found`;

  if (!total) {
    pg.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3>No products found</h3>
        <p>Try a different search or category.</p>
        <button class="btn btn-outline" id="clearFiltersBtn">Clear Filters</button>
      </div>`;
    $("clearFiltersBtn")?.addEventListener("click", clearFilters);
    if (lmw) lmw.style.display = "none";
    return;
  }

  pg.innerHTML = filtered.map(productCard).join("");
  if (lmw) lmw.style.display = currentPage < totalPages ? "" : "none";
}

// ============================================================
// PRODUCT CARD
// ============================================================

function productCard(p) {
  const id = Number(p.id);
  const price = effectivePrice(p), regular = Number(p.price||0);
  const hasSale = p.discount_price != null && Number(p.discount_price) < regular;
  const pct = hasSale ? Math.round((1 - price/regular)*100) : 0;
  const stock = Number(p.stock||0);
  const outOfStock = stock <= 0, lowStock = stock > 0 && stock <= 5;
  const rating = Number(p.rating||0), reviews = Number(p.reviews_count||0);
  const isWished = wishlistIds.has(id);

  return `
    <article class="product-card" data-product-id="${id}" role="button" tabindex="0" aria-label="View ${esc(p.name)}">
      ${hasSale ? `<span class="card-sale-badge">-${pct}%</span>` : ""}
      <button class="card-wishlist-btn${isWished?" wishlisted":""}" data-action="wishlist"
              data-product-id="${id}" aria-label="${isWished?"Remove from":"Add to"} wishlist">
        ${isWished?"❤️":"🤍"}
      </button>
      <div class="product-image">
        ${p.image
          ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
          : `<span class="product-image-emoji">${esc(p.icon||"📦")}</span>`}
      </div>
      <div class="product-info">
        <div class="product-category">${esc(p.category||"")}</div>
        <h3 class="product-name">${esc(p.name||"")}</h3>
        ${p.brand ? `<div class="product-brand">${esc(p.brand)}</div>` : ""}
        ${rating > 0 ? `
          <div class="product-rating">
            <span class="stars">${starsHtml(rating)}</span>
            <span class="rating-count">${rating.toFixed(1)}${reviews>0?` (${reviews})`:""}</span>
          </div>` : ""}
        <div class="product-bottom">
          <div class="price-group">
            <span class="product-price">${money(price)}</span>
            ${hasSale ? `<span class="original-price">${money(regular)}</span>` : ""}
          </div>
          <span class="product-stock ${outOfStock?"stock-out":lowStock?"stock-low":"stock-ok"}">
            ${outOfStock?"Out of stock":lowStock?`Only ${stock} left`:`${stock} in stock`}
          </span>
        </div>
        <button class="add-cart" data-action="add-cart" data-product-id="${id}"${outOfStock?" disabled":""}>
          ${outOfStock?"Out of Stock":"🛒 Add to Cart"}
        </button>
      </div>
    </article>`;
}

// ============================================================
// GRID EVENT DELEGATION
// ============================================================

function onGridClick(e) {
  const wishBtn = e.target.closest("[data-action='wishlist']");
  if (wishBtn) { e.stopPropagation(); toggleWishlist(Number(wishBtn.dataset.productId)); return; }
  const cartBtn = e.target.closest("[data-action='add-cart']");
  if (cartBtn) { e.stopPropagation(); addToCart(Number(cartBtn.dataset.productId)); return; }
  const card = e.target.closest(".product-card");
  if (card) openProductDetail(Number(card.dataset.productId));
}

$("productsGrid")?.addEventListener("click", onGridClick);
$("featuredGrid")?.addEventListener("click", onGridClick);
$("recentlyViewedGrid")?.addEventListener("click", onGridClick);

document.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const card = e.target.closest(".product-card[tabindex]");
    if (card) openProductDetail(Number(card.dataset.productId));
  }
});

// ============================================================
// SEARCH
// ============================================================

let searchTimer = null;
function doSearch() {
  currentSearch = $("searchInput")?.value.trim() || "";
  loadSuggestions(currentSearch);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadProducts(), 250);
}

$("searchButton")?.addEventListener("click", doSearch);
$("searchInput")?.addEventListener("input", doSearch);
$("searchInput")?.addEventListener("keydown", e => { if (e.key==="Enter") { e.preventDefault(); doSearch(); } });

// ============================================================
// FILTERS
// ============================================================

$("categoryFilter")?.addEventListener("change", () => {
  currentCategory = $("categoryFilter").value;
  loadProducts();
});

$("sortSelect")?.addEventListener("change", () => {
  currentSort = $("sortSelect").value;
  loadProducts();
});

document.addEventListener("click", e => {
  const btn = e.target.closest(".cat-btn");
  if (!btn) return;
  $$(".cat-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentCategory = btn.dataset.category;
  const cf = $("categoryFilter");
  if (cf) cf.value = currentCategory;
  loadProducts();
  $("products")?.scrollIntoView({ behavior:"smooth", block:"start" });
});

document.addEventListener("click", e => {
  const btn = e.target.closest(".banner-link, .footer-cat-link");
  if (!btn) return;
  const cat = btn.dataset.category || "";
  currentCategory = cat;
  const cf = $("categoryFilter");
  if (cf) cf.value = cat;
  $$(".cat-btn").forEach(b => b.classList.toggle("active", b.dataset.category === cat));
  loadProducts();
  $("products")?.scrollIntoView({ behavior:"smooth", block:"start" });
});

function clearFilters() {
  currentSearch = ""; currentCategory = ""; currentSort = "newest"; currentPage = 1;
  const si = $("searchInput"), cf = $("categoryFilter"), ss = $("sortSelect");
  if (si) si.value = "";
  if (cf) cf.value = "";
  if (ss) ss.value = "newest";
  $$(".cat-btn").forEach(b => b.classList.toggle("active", b.dataset.category === ""));
  loadProducts();
}

$("loadMoreBtn")?.addEventListener("click", () => {
  if (currentPage < totalPages) {
    currentPage += 1;
    loadProducts(false);
  }
});

// ============================================================
// CART — ADD / REMOVE / CHANGE QTY
// ============================================================

function addToCart(productId, qty = 1) {
  const p = getProduct(productId);
  if (!p) return toast("Product not found.", "error");
  const stock = Number(p.stock||0);
  if (stock <= 0) return toast("This product is out of stock.", "error");
  const existing = getCartItem(productId);
  if (existing) {
    if (existing.quantity + qty > stock) return toast(`Only ${stock} available.`, "warning");
    existing.quantity += qty;
  } else {
    cart.push({ id: Number(p.id), quantity: qty });
  }
  saveCart(); renderCart();
  toast(`${p.name} added to cart.`, "success", "Added to Cart");
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.id !== Number(productId));
  saveCart(); renderCart();
}

function changeQty(productId, delta) {
  const item = getCartItem(productId), p = getProduct(productId);
  if (!item || !p) return;
  const stock = Number(p.stock||0);
  const newQty = item.quantity + delta;
  if (newQty <= 0) { removeFromCart(productId); return; }
  if (newQty > stock) { toast(`Only ${stock} available.`, "warning"); return; }
  item.quantity = newQty; saveCart(); renderCart();
}

function syncCart() {
  cart = cart.map(i => {
    const p = getProduct(i.id);
    if (!p || Number(p.stock||0) <= 0) return null;
    return { id: i.id, quantity: Math.min(i.quantity, Number(p.stock)) };
  }).filter(Boolean);
  saveCart();
}

// ============================================================
// RENDER CART
// ============================================================

function renderCart() {
  const items = getCartProducts();
  const count = items.reduce((s,i) => s+i.quantity, 0);
  const cc = $("cartCount");
  if (cc) cc.textContent = count;

  const ci = $("cartItems");
  if (!ci) return;

  if (!items.length) {
    ci.innerHTML = `
      <div class="empty-state" style="padding:40px 20px">
        <div class="empty-state-icon">🛒</div>
        <h3>Your cart is empty</h3>
        <p>Add some products to get started.</p>
      </div>`;
  } else {
    ci.innerHTML = items.map(i => {
      const price = effectivePrice(i);
      return `
        <div class="cart-item" data-product-id="${i.id}">
          <div class="cart-item-image">
            ${i.image?`<img src="${esc(i.image)}" alt="${esc(i.name)}">`:esc(i.icon||"📦")}
          </div>
          <div class="cart-item-info">
            <div class="cart-item-name">${esc(i.name)}</div>
            <div class="cart-item-meta">${esc(i.category||"")}</div>
            <div class="cart-item-price">${money(price)}</div>
            <div class="quantity-controls">
              <button class="qty-btn" data-action="decrease" data-product-id="${i.id}" aria-label="Decrease">−</button>
              <span class="quantity">${i.quantity}</span>
              <button class="qty-btn" data-action="increase" data-product-id="${i.id}" aria-label="Increase">+</button>
            </div>
            <button class="remove-cart-item" data-action="remove" data-product-id="${i.id}">Remove</button>
          </div>
          <span class="cart-item-subtotal">${money(price*i.quantity)}</span>
        </div>`;
    }).join("");
  }

  const sub = cartSubtotalVal();
  const del = items.length > 0 ? deliveryCost("standard") : 0;
  const cs = $("cartSubtotal"), cd = $("cartDelivery"), ct = $("cartTotal"), chkBtn = $("checkoutButton");
  if (cs) cs.textContent = money(sub);
  if (cd) cd.textContent = money(del);
  if (ct) ct.textContent = money(sub+del);
  if (chkBtn) chkBtn.disabled = !items.length;
}

$("cartItems")?.addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.productId);
  if (!id) return;
  const action = btn.dataset.action;
  if (action==="increase") changeQty(id,  1);
  if (action==="decrease") changeQty(id, -1);
  if (action==="remove")   removeFromCart(id);
});

// ============================================================
// CART OPEN / CLOSE
// ============================================================

function openCart()        { renderCart(); $("cartSidebar")?.classList.add("active"); $("cartOverlay")?.classList.add("active"); document.body.style.overflow="hidden"; }
function closeCartSidebar(){ $("cartSidebar")?.classList.remove("active"); $("cartOverlay")?.classList.remove("active"); document.body.style.overflow=""; }

$("cartButton")?.addEventListener("click", openCart);
$("closeCart")?.addEventListener("click", closeCartSidebar);
$("cartOverlay")?.addEventListener("click", closeCartSidebar);

// ============================================================
// CHECKOUT — OPEN / CLOSE
// ============================================================

function openCheckout() {
  if (!getCartProducts().length) return toast("Your cart is empty.", "warning");
  closeCartSidebar();
  if (currentUser) {
    const n=$("customerName"),em=$("customerEmail"),ad=$("customerAddress");
    if (n  && !n.value)  n.value  = currentUser.name    || "";
    if (em && !em.value) em.value = currentUser.email   || "";
    if (ad && !ad.value) ad.value = currentUser.address || "";
  }
  appliedCoupon = null;
  const ci=$("couponInput"),cm=$("couponMessage"),dr=$("discountRow");
  if (ci) ci.value = "";
  if (cm) { cm.style.display="none"; cm.textContent=""; }
  if (dr) dr.style.display = "none";
  buildCheckoutItems();
  updateCheckoutTotals();
  showMessage($("checkoutMessage"),"","");
  $("checkoutOverlay")?.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeCheckoutModal() {
  $("checkoutOverlay")?.classList.remove("active");
  document.body.style.overflow = "";
}

$("checkoutButton")?.addEventListener("click", openCheckout);
$("closeCheckout")?.addEventListener("click", closeCheckoutModal);
$("checkoutOverlay")?.addEventListener("click", e => { if (e.target===$("checkoutOverlay")) closeCheckoutModal(); });

function buildCheckoutItems() {
  const list = $("checkoutItemsList");
  if (!list) return;
  list.innerHTML = getCartProducts().map(i => {
    const price = effectivePrice(i);
    return `
      <div class="checkout-item">
        <div class="checkout-item-image">
          ${i.image?`<img src="${esc(i.image)}" alt="${esc(i.name)}">`:esc(i.icon||"📦")}
        </div>
        <div class="checkout-item-info">
          <div class="checkout-item-name">${esc(i.name)}</div>
          <div class="checkout-item-qty">× ${i.quantity}</div>
        </div>
        <span class="checkout-item-price">${money(price*i.quantity)}</span>
      </div>`;
  }).join("");
}

function updateCheckoutTotals() {
  const method = $("deliveryMethod")?.value || "standard";
  const sub    = cartSubtotalVal();
  const disc   = appliedCoupon ? appliedCoupon.discount : 0;
  const del    = deliveryCost(method);
  const total  = Math.max(0, sub-disc) + del;
  const cs=$("checkoutSubtotal"),cd=$("checkoutDelivery"),ct=$("checkoutTotal"),
        cdisc=$("checkoutDiscount"),dr=$("discountRow");
  if (cs)    cs.textContent   = money(sub);
  if (cd)    cd.textContent   = money(del);
  if (ct)    ct.textContent   = money(total);
  if (dr)    dr.style.display = disc>0 ? "" : "none";
  if (cdisc) cdisc.textContent = `−${money(disc)}`;
}

$("deliveryMethod")?.addEventListener("change", updateCheckoutTotals);

// ============================================================
// COUPON
// ============================================================

$("applyCouponBtn")?.addEventListener("click", async () => {
  const code = $("couponInput")?.value.trim();
  if (!code) return;
  const btn = $("applyCouponBtn");
  if (btn) { btn.disabled=true; btn.textContent="Checking…"; }

  function setInline(msg, type) {
    const cm=$("couponMessage");
    if (!cm) return;
    cm.textContent=msg; cm.className=`coupon-message ${type}`; cm.style.display=msg?"":"none";
  }

  try {
    const data = await api(`${API}/coupons/validate`,{
      method:"POST", body:JSON.stringify({ code, subtotal: cartSubtotalVal() })
    });
    appliedCoupon = { code: data.coupon.code, discount: data.discount };
    setInline(`✓ "${data.coupon.code}" applied — you save ${money(data.discount)}!`, "success");
    updateCheckoutTotals();
  } catch(err) {
    appliedCoupon = null;
    setInline(err.message, "error");
    updateCheckoutTotals();
  } finally {
    if (btn) { btn.disabled=false; btn.textContent="Apply"; }
  }
});

// ============================================================
// PLACE ORDER
// ============================================================
// PLACE ORDER + STRIPE REDIRECT
// ============================================================

$("checkoutForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  if (isPlacingOrder) return;
  const items = getCartProducts();
  if (!items.length) return showMessage($("checkoutMessage"),"Your cart is empty.","error");

  const name    = $("customerName")?.value.trim()    || "";
  const email   = $("customerEmail")?.value.trim()   || "";
  const phone   = $("customerPhone")?.value.trim()   || "";
  const address = $("customerAddress")?.value.trim() || "";
  const method  = $("deliveryMethod")?.value         || "standard";
  const notes   = $("orderNotes")?.value.trim()      || "";
  const payWithCard = $("payWithCardCheckbox")?.checked || false;

  if (!name) {
    showMessage($("checkoutMessage"),"Please enter your full name.","error");
    $("customerName")?.focus(); return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage($("checkoutMessage"),"Please enter a valid email address.","error");
    $("customerEmail")?.focus(); return;
  }

  isPlacingOrder = true;
  const idempotencyKey = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const placeBtn = $("placeOrderButton");
  if (placeBtn) { placeBtn.disabled=true; placeBtn.textContent="Processing…"; }
  showMessage($("checkoutMessage"),"","");

  try {
    // Step 1 — create the order
    const data = await api(`${API}/orders`, {
      method:"POST",
      headers: { "X-Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        customer_name: name, customer_email: email, customer_phone: phone,
        customer_address: address, delivery_method: method, notes,
        items: items.map(i=>({ product_id:Number(i.id), quantity:i.quantity })),
        coupon_code: appliedCoupon?.code || ""
      })
    });

    cart=[]; saveCart(); renderCart(); appliedCoupon=null;
    $("checkoutForm")?.reset();
    const dm=$("deliveryMethod"); if (dm) dm.value="standard";
    updateCheckoutTotals();
    closeCheckoutModal();

    // Step 2 — if Pay with Card, redirect to Stripe
    if (payWithCard && email) {
      if (placeBtn) placeBtn.textContent = "Redirecting to payment…";
      try {
        const stripe = await api(`${API}/payments/checkout`, {
          method: "POST",
          body: JSON.stringify({ order_id: data.order.id, customer_email: email })
        });
        if (stripe.url) {
          window.location.href = stripe.url;
          return; // stop — page will redirect
        }
      } catch (stripeErr) {
        // Stripe not configured — fall through to confirmation
        console.warn("Stripe redirect failed:", stripeErr.message);
      }
    }

    // Step 3 — show confirmation (cash / stripe not configured)
    showOrderConfirmation(data.order, data.items);
    await loadProducts();

  } catch(err) {
    showMessage($("checkoutMessage"), err.message||"Could not place order.", "error");
  } finally {
    isPlacingOrder=false;
    if (placeBtn) { placeBtn.disabled=false; placeBtn.textContent="Place Order"; }
  }
});

// ============================================================
// ORDER CONFIRMATION
// ============================================================

function showOrderConfirmation(order, items=[]) {
  const oc=$("orderConfirmation"); if (!oc) return;
  const set=(id,v)=>{ const e=$(id); if(e) e.textContent=v??""; };
  set("confirmationOrderId",       order.order_number||order.id);
  set("confirmationCustomer",      order.customer_name);
  set("confirmationEmail",         order.customer_email||"—");
  set("confirmationAddress",       order.customer_address||"—");
  set("confirmationDeliveryMethod",formatMethod(order.delivery_method));
  set("confirmationStatus",        order.status||"Pending");
  set("confirmationPayment",       order.payment_status||"Unpaid");
  set("confirmationSubtotal",      money(order.subtotal));
  set("confirmationDelivery",      money(order.delivery_cost));
  set("confirmationTotal",         money(order.total));

  const dr=$("confDiscountRow"), de=$("confirmationDiscount");
  if (Number(order.discount)>0) { if(dr)dr.style.display=""; if(de)de.textContent=`−${money(order.discount)}`; }
  else { if(dr)dr.style.display="none"; }

  const ci=$("confirmationItems");
  if (ci) ci.innerHTML = items.length
    ? items.map(i=>`
        <div class="conf-item">
          <div>
            <span class="conf-item-name">${esc(i.product_name||i.name||"Product")}</span>
            <span class="conf-item-qty"> × ${i.quantity}</span>
          </div>
          <span class="conf-item-price">${money(Number(i.price)*i.quantity)}</span>
        </div>`).join("")
    : "<p>No item details available.</p>";

  oc.style.display="";
  oc.scrollIntoView({ behavior:"smooth", block:"start" });
}

$("continueShoppingButton")?.addEventListener("click", () => {
  const oc=$("orderConfirmation"); if(oc) oc.style.display="none";
  window.scrollTo({ top:0, behavior:"smooth" });
});

// ============================================================
// AUTH MODAL
// ============================================================

function openAuth(tab="login") {
  switchAuthTab(tab);
  showMessage($("loginMessage"),"","");
  showMessage($("registerMessage"),"","");
  $("authOverlay")?.classList.add("active");
  document.body.style.overflow="hidden";
}

function closeAuthModal() {
  $("authOverlay")?.classList.remove("active");
  document.body.style.overflow="";
}

function switchAuthTab(tab) {
  const isLogin = tab==="login";
  $("loginTab")?.classList.toggle("active", isLogin);
  $("registerTab")?.classList.toggle("active", !isLogin);
  const lf=$("loginForm"), rf=$("registerForm"), title=$("authModalTitle");
  $("forgotPasswordForm") && ($("forgotPasswordForm").style.display = "none");
  $("resetPasswordForm") && ($("resetPasswordForm").style.display = "none");
  if (lf) lf.style.display    = isLogin ? "" : "none";
  if (rf) rf.style.display    = isLogin ? "none" : "";
  if (title) title.textContent = isLogin ? "Sign In" : "Create Account";
}

function openPasswordReset(token) {
  openAuth("login");
  $("loginForm").style.display = "none";
  $("registerForm").style.display = "none";
  $("resetPasswordForm").style.display = "";
  $("authModalTitle").textContent = "Reset Password";
  $("resetPasswordForm").dataset.token = token;
}

$("authButton")?.addEventListener("click", () => {
  currentUser ? openAccount("profile") : openAuth("login");
});
$("closeAuth")?.addEventListener("click", closeAuthModal);
$("authOverlay")?.addEventListener("click", e => { if(e.target===$("authOverlay")) closeAuthModal(); });
$("forgotPasswordButton")?.addEventListener("click", () => {
  $("loginForm").style.display = "none";
  $("registerForm").style.display = "none";
  $("forgotPasswordForm").style.display = "";
  $("authModalTitle").textContent = "Forgot Password";
});

$("forgotPasswordForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const data = await api(`${API}/auth/forgot-password`, { method:"POST", body:JSON.stringify({ email:$("forgotEmail").value.trim() }) });
    showMessage($("forgotMessage"), data.message, "success");
  } catch (err) { showMessage($("forgotMessage"), err.message, "error"); }
});

$("resetPasswordForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const data = await api(`${API}/auth/reset-password`, { method:"POST", body:JSON.stringify({ token:e.currentTarget.dataset.token, password:$("resetPassword").value }) });
    showMessage($("resetMessage"), data.message, "success");
    e.currentTarget.reset();
  } catch (err) { showMessage($("resetMessage"), err.message, "error"); }
});

document.addEventListener("click", e => {
  const btn = e.target.closest(".auth-tab[data-tab], .link-btn[data-tab]");
  if (btn) switchAuthTab(btn.dataset.tab);
});

const resetToken = new URLSearchParams(location.search).get("reset");
const verifyToken = new URLSearchParams(location.search).get("verify");
if (resetToken) openPasswordReset(resetToken);
if (verifyToken) {
  api(`${API}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`)
    .then(data => toast(data.message, "success"))
    .catch(err => toast(err.message, "error"));
}

// ============================================================
// AUTH — LOGIN
// ============================================================

$("loginForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  showMessage($("loginMessage"),"","");
  const email    = $("loginEmail")?.value.trim()  || "";
  const password = $("loginPassword")?.value       || "";
  if (!email||!password) return showMessage($("loginMessage"),"Email and password are required.","error");
  const btn = $("loginForm").querySelector("button[type=submit]");
  if (btn) { btn.disabled=true; btn.textContent="Signing in…"; }
  try {
    const data = await api(`${API}/auth/login`,{ method:"POST", body:JSON.stringify({ email, password }) });
    setUser(data.user);
    closeAuthModal();
    toast(`Welcome back, ${data.user.name}!`, "success");
    loadWishlist();
  } catch(err) { showMessage($("loginMessage"), err.message, "error"); }
  finally { if(btn) { btn.disabled=false; btn.textContent="Sign In"; } }
});

// ============================================================
// AUTH — REGISTER
// ============================================================

$("registerForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  showMessage($("registerMessage"),"","");
  const name     = $("registerName")?.value.trim()     || "";
  const phone    = $("registerPhone")?.value.trim()    || "";
  const email    = $("registerEmail")?.value.trim()    || "";
  const password = $("registerPassword")?.value         || "";
  if (!name)               return showMessage($("registerMessage"),"Please enter your name.","error");
  if (!email)              return showMessage($("registerMessage"),"Please enter your email.","error");
  if (password.length < 8) return showMessage($("registerMessage"),"Password must be at least 8 characters.","error");
  const btn = $("registerForm").querySelector("button[type=submit]");
  if (btn) { btn.disabled=true; btn.textContent="Creating account…"; }
  try {
    const data = await api(`${API}/auth/register`,{ method:"POST", body:JSON.stringify({ name, email, password, phone }) });
    setUser(data.user);
    closeAuthModal();
    toast(`Welcome, ${data.user.name}! Your account has been created.`, "success");
    loadWishlist();
  } catch(err) { showMessage($("registerMessage"), err.message, "error"); }
  finally { if(btn) { btn.disabled=false; btn.textContent="Create Account"; } }
});

// ============================================================
// USER — SET / CLEAR / RESTORE
// ============================================================

function setUser(user) {
  currentUser = user;
  localStorage.setItem("es_user",  JSON.stringify(user));
  updateAuthUI();
}

function clearUser() {
  currentUser = null; wishlistIds.clear();
  localStorage.removeItem("es_token"); localStorage.removeItem("es_user");
  api(`${API}/auth/logout`, { method: "POST" }).catch(() => {});
  updateAuthUI(); updateWishlistUI();
}

function updateAuthUI() {
  const lbl = $("authLabel");
  if (!lbl) return;
  if (currentUser) {
    lbl.textContent = currentUser.name.split(" ")[0];
    const fs=$("footerSignIn"), fr=$("footerRegister");
    if (fs) fs.textContent = "My Account";
    if (fr) fr.textContent = "My Profile";
  } else {
    lbl.textContent = "Sign In";
    const fs=$("footerSignIn"), fr=$("footerRegister");
    if (fs) fs.textContent = "Sign In";
    if (fr) fr.textContent = "Create Account";
  }
}

function restoreSession() {
  const userStr=localStorage.getItem("es_user");
  if (userStr) {
    try { currentUser=JSON.parse(userStr); updateAuthUI(); }
    catch { clearUser(); }
  }
}

// ============================================================
// ACCOUNT MODAL
// ============================================================

function openAccount(panel="profile") {
  if (!currentUser) { openAuth("login"); return; }
  const n=$("profileName"),ph=$("profilePhone"),ad=$("profileAddress");
  if (n)  n.value  = currentUser.name    || "";
  if (ph) ph.value = currentUser.phone   || "";
  if (ad) ad.value = currentUser.address || "";
  switchAccountPanel(panel);
  $("accountOverlay")?.classList.add("active");
  document.body.style.overflow="hidden";
  if (panel==="orders")         loadMyOrders();
  if (panel==="wishlist-panel") renderWishlistPanel();
}

function closeAccountModal() {
  $("accountOverlay")?.classList.remove("active");
  document.body.style.overflow="";
}

function switchAccountPanel(id) {
  $$(".account-nav-item:not(.account-signout)").forEach(b => b.classList.toggle("active", b.dataset.panel===id));
  $$(".account-panel").forEach(p => p.classList.toggle("active", p.id===`panel-${id}`));
}

$("closeAccount")?.addEventListener("click", closeAccountModal);
$("accountOverlay")?.addEventListener("click", e => { if(e.target===$("accountOverlay")) closeAccountModal(); });

$("accountOverlay")?.addEventListener("click", e => {
  const btn = e.target.closest(".account-nav-item[data-panel]");
  if (!btn) return;
  const panel = btn.dataset.panel;
  switchAccountPanel(panel);
  if (panel==="orders")         loadMyOrders();
  if (panel==="wishlist-panel") renderWishlistPanel();
});

$("signOutBtn")?.addEventListener("click", () => { clearUser(); closeAccountModal(); toast("You've been signed out.","info"); });

// Footer / header shortcuts
$("footerOrders")?.addEventListener("click",   e=>{ e.preventDefault(); openAccount("orders"); });
$("footerWishlist")?.addEventListener("click", e=>{ e.preventDefault(); openAccount("wishlist-panel"); });
$("footerSignIn")?.addEventListener("click",   e=>{ e.preventDefault(); currentUser ? openAccount("profile") : openAuth("login"); });
$("footerRegister")?.addEventListener("click", e=>{ e.preventDefault(); currentUser ? openAccount("profile") : openAuth("register"); });
$("wishlistButton")?.addEventListener("click", () => { currentUser ? openAccount("wishlist-panel") : openAuth("login"); });

// ============================================================
// PROFILE UPDATE
// ============================================================

$("profileForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  showMessage($("profileMessage"),"","");
  const name=$("profileName")?.value.trim()||"", phone=$("profilePhone")?.value.trim()||"", address=$("profileAddress")?.value.trim()||"";
  if (!name) return showMessage($("profileMessage"),"Name is required.","error");
  const btn=$("profileForm").querySelector("button[type=submit]");
  if (btn) { btn.disabled=true; btn.textContent="Saving…"; }
  try {
    const data = await api(`${API}/auth/profile`,{ method:"PUT", body:JSON.stringify({ name, phone, address }) });
    currentUser = data.user;
    localStorage.setItem("es_user", JSON.stringify(data.user));
    updateAuthUI();
    showMessage($("profileMessage"),"Profile updated successfully.","success");
    toast("Profile saved.","success");
  } catch(err) { showMessage($("profileMessage"), err.message,"error"); }
  finally { if(btn) { btn.disabled=false; btn.textContent="Save Changes"; } }
});

// ============================================================
// CHANGE PASSWORD
// ============================================================

$("passwordForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  showMessage($("passwordMessage"),"","");
  const cur=$("currentPassword")?.value||"", nw=$("newPassword")?.value||"";
  if (!cur||!nw) return showMessage($("passwordMessage"),"Both fields are required.","error");
  if (nw.length<8) return showMessage($("passwordMessage"),"New password must be at least 8 characters.","error");
  const btn=$("passwordForm").querySelector("button[type=submit]");
  if (btn) { btn.disabled=true; btn.textContent="Updating…"; }
  try {
    await api(`${API}/auth/password`,{ method:"PUT", body:JSON.stringify({ current_password:cur, new_password:nw }) });
    $("passwordForm").reset();
    showMessage($("passwordMessage"),"Password changed successfully.","success");
    toast("Password updated.","success");
  } catch(err) { showMessage($("passwordMessage"), err.message,"error"); }
  finally { if(btn) { btn.disabled=false; btn.textContent="Change Password"; } }
});

// Toggle password visibility
document.addEventListener("click", e => {
  const btn = e.target.closest(".toggle-password[data-target]");
  if (!btn) return;
  const input = $(btn.dataset.target);
  if (!input) return;
  input.type = input.type==="password" ? "text" : "password";
  btn.textContent = input.type==="password" ? "👁" : "🙈";
});

// ============================================================
// MY ORDERS
// ============================================================

async function loadMyOrders() {
  const list = $("myOrdersList");
  if (!list) return;
  list.innerHTML = `<p class="text-muted">Loading your orders…</p>`;
  try {
    const data = await api(`${API}/my/orders`);
    const orders = data.orders || [];
    if (!orders.length) {
      list.innerHTML = `
        <div class="empty-state" style="padding:30px 0">
          <div class="empty-state-icon">📦</div>
          <h3>No orders yet</h3>
          <p>Your orders will appear here once you place one.</p>
        </div>`;
      return;
    }
    list.innerHTML = orders.map(o => {
      const itemSummary = (o.items||[]).slice(0,3).map(i=>esc(i.product_name||i.name||"Item")).join(", ")
        + (o.items?.length>3 ? ` +${o.items.length-3} more` : "");
      return `
        <div class="order-history-item">
          <div class="order-history-header">
            <span class="order-history-number">${esc(o.order_number||`#${o.id}`)}</span>
            <span class="status-badge status-${esc(o.status||"pending")}">${esc(o.status||"pending")}</span>
          </div>
          <div class="order-history-items">${itemSummary||"—"}</div>
          ${o.tracking_number ? `<div class="order-history-items">🚚 Tracking: <strong>${esc(o.tracking_number)}</strong></div>` : ""}
          ${o.estimated_delivery ? `<div class="order-history-items">📅 Estimated delivery: <strong>${esc(o.estimated_delivery)}</strong></div>` : ""}
          ${Array.isArray(o.history) && o.history.length ? `
            <div class="order-history-items">
              ${o.history.map(h => `${esc(h.status)}${h.note ? ` — ${esc(h.note)}` : ""}`).join(" · ")}
            </div>` : ""}
          <div class="order-history-footer">
            <span class="order-history-date">${fmtDate(o.created_at)}</span>
            <span class="order-history-total">${money(o.total)}</span>
          </div>
        </div>`;
    }).join("");
  } catch(err) {
    list.innerHTML = `<p class="text-muted" style="color:var(--danger)">Could not load orders: ${esc(err.message)}</p>`;
  }
}

// ============================================================
// WISHLIST
// ============================================================

async function loadWishlist() {
  if (!currentUser) return;
  try {
    const data = await api(`${API}/wishlist`);
    wishlistItems = data.items || [];
    wishlistIds = new Set(wishlistItems.map(i=>Number(i.id)));
    updateWishlistUI();
    // Refresh card hearts in grids
    renderProducts();
    renderFeatured();
  } catch(err) { console.error("loadWishlist:", err); }
}

function updateWishlistUI() {
  const cnt = $("wishlistCount");
  if (!cnt) return;
  if (wishlistIds.size > 0) {
    cnt.textContent = wishlistIds.size;
    cnt.style.display = "";
  } else {
    cnt.style.display = "none";
  }
}

async function toggleWishlist(productId) {
  if (!currentUser) { openAuth("login"); toast("Sign in to save products to your wishlist.","info"); return; }
  const isWished = wishlistIds.has(productId);
  try {
    if (isWished) {
      await api(`${API}/wishlist/${productId}`,{ method:"DELETE" });
      wishlistIds.delete(productId);
      toast("Removed from wishlist.","info");
    } else {
      await api(`${API}/wishlist`,{ method:"POST", body:JSON.stringify({ product_id: productId }) });
      wishlistIds.add(productId);
      toast("Added to wishlist.", "success", "Saved");
    }
    updateWishlistUI();
    // Update heart icons in grids without full re-render
    $$(`[data-action="wishlist"][data-product-id="${productId}"]`).forEach(btn => {
      btn.classList.toggle("wishlisted", wishlistIds.has(productId));
      btn.innerHTML = wishlistIds.has(productId) ? "❤️" : "🤍";
    });
  } catch(err) { toast(err.message,"error"); }
}

function renderWishlistPanel() {
  const grid = $("wishlistGrid");
  if (!grid) return;
  if (!currentUser) { grid.innerHTML=`<p class="text-muted">Sign in to see your wishlist.</p>`; return; }
  if (!wishlistIds.size) {
    grid.innerHTML=`
      <div class="empty-state" style="padding:30px 0">
        <div class="empty-state-icon">🤍</div>
        <h3>Your wishlist is empty</h3>
        <p>Tap the heart on any product to save it here.</p>
      </div>`;
    return;
  }
  const wished = wishlistItems.filter(p => wishlistIds.has(Number(p.id)));
  grid.innerHTML = wished.length ? `
    <div class="wishlist-toolbar">
      <span class="text-muted">${wished.length} saved item${wished.length === 1 ? "" : "s"}</span>
      <div>
        <button class="btn btn-primary btn-sm" id="wishlistAddAllBtn">🛒 Add available to cart</button>
        <button class="btn btn-ghost btn-sm" id="wishlistClearBtn">Clear wishlist</button>
      </div>
    </div>
    <div class="products-grid products-grid--small">${wished.map(productCard).join("")}</div>` :
    `<p class="text-muted">Your saved products are not available anymore.</p>`;
  grid.addEventListener("click", onGridClick);
  $("wishlistAddAllBtn")?.addEventListener("click", () => {
    wished.filter(product => Number(product.stock || 0) > 0).forEach(product => addToCart(Number(product.id)));
    toast("Available wishlist items added to cart.", "success");
  });
  $("wishlistClearBtn")?.addEventListener("click", async () => {
    if (!confirm("Clear your entire wishlist?")) return;
    try {
      await api(`${API}/wishlist`, { method: "DELETE" });
      wishlistItems = [];
      wishlistIds.clear();
      updateWishlistUI();
      renderWishlistPanel();
      renderProducts();
      renderFeatured();
      toast("Wishlist cleared.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ============================================================
// PRODUCT DETAIL MODAL
// ============================================================

async function openProductDetail(productId) {
  const p = getProduct(productId);
  if (!p) return;

  detailProductId = productId;
  rememberViewed(productId);
  detailQty = 1;
  reviewStarVal = 5;

  const body = $("productModalBody");
  if (!body) return;

  const price = effectivePrice(p), regular = Number(p.price||0);
  const hasSale = p.discount_price!=null && Number(p.discount_price)<regular;
  const pct = hasSale ? Math.round((1-price/regular)*100) : 0;
  const stock = Number(p.stock||0);
  const outOfStock = stock<=0;
  const isWished = wishlistIds.has(productId);
  const rating = Number(p.rating||0);

  body.innerHTML = `
    <div class="product-detail">
      <div class="product-detail-image">
        ${p.image
          ? `<img src="${esc(p.image)}" alt="${esc(p.name)}">`
          : `<span>${esc(p.icon||"📦")}</span>`}
      </div>
      <div class="product-detail-info">
        <div class="product-detail-category">${esc(p.category||"")}</div>
        <h2 class="product-detail-name" id="productModalTitle">${esc(p.name||"")}</h2>
        ${p.brand ? `<div class="product-detail-brand">by ${esc(p.brand)}</div>` : ""}

        ${rating>0 ? `
          <div class="product-rating">
            <span class="stars">${starsHtml(rating)}</span>
            <span class="rating-count">${rating.toFixed(1)} (${p.reviews_count||0} reviews)</span>
          </div>` : ""}

        <div class="product-detail-price-row">
          <span class="product-detail-price">${money(price)}</span>
          ${hasSale ? `<span class="product-detail-original">${money(regular)}</span>
          <span class="discount-pct">-${pct}%</span>` : ""}
        </div>

        ${p.description ? `<p class="product-detail-desc">${esc(p.description)}</p>` : ""}

        <div class="product-detail-meta">
          ${p.sku ? `<div class="product-detail-meta-row"><span class="product-detail-meta-label">SKU</span><span class="product-detail-meta-value">${esc(p.sku)}</span></div>` : ""}
          <div class="product-detail-meta-row">
            <span class="product-detail-meta-label">Availability</span>
            <span class="product-detail-meta-value ${outOfStock?"stock-out":stock<=5?"stock-low":"stock-ok"}">
              ${outOfStock?"Out of stock":stock<=5?`Only ${stock} left`:`${stock} in stock`}
            </span>
          </div>
        </div>

        ${!outOfStock ? `
          <div class="product-detail-actions">
            <div class="product-detail-qty">
              <button class="qty-btn" id="detailDecBtn" aria-label="Decrease">−</button>
              <span class="product-detail-qty-val" id="detailQtyVal">1</span>
              <button class="qty-btn" id="detailIncBtn" aria-label="Increase">+</button>
            </div>
            <button class="btn btn-primary flex-1" id="detailAddCartBtn">
              🛒 Add to Cart
            </button>
          </div>` : `<button class="btn btn-primary" disabled>Out of Stock</button>`}

        <button class="btn btn-ghost" id="detailWishlistBtn" style="margin-top:4px">
          ${isWished?"❤️ Remove from Wishlist":"🤍 Add to Wishlist"}
        </button>
      </div>
    </div>

    <div class="reviews-section" id="reviewsSection">
      <h4>Customer Reviews</h4>
      <div id="reviewsList"><p class="text-muted">Loading reviews…</p></div>

      ${currentUser ? `
        <div class="write-review-form" id="writeReviewForm">
          <h5>Write a Review</h5>
          <div class="star-picker" id="starPicker">
            ${[1,2,3,4,5].map(n=>`<button type="button" data-star="${n}" class="${n<=reviewStarVal?"active":""}" aria-label="${n} star${n>1?"s":""}">★</button>`).join("")}
          </div>
          <div class="field-group" style="margin-bottom:12px">
            <textarea id="reviewComment" placeholder="Share your experience…" rows="3"></textarea>
          </div>
          <button class="btn btn-primary btn-sm" id="submitReviewBtn">Submit Review</button>
          <div id="reviewMessage" class="form-message" style="display:none;margin-top:8px"></div>
        </div>` : `
        <p class="text-muted" style="margin-top:12px">
          <button class="link-btn" onclick="openAuth('login')">Sign in</button> to write a review.
        </p>`}
    </div>`;

  // Load related products without delaying the detail modal.
  api(`${API}/products/${productId}/related`)
    .then(relatedResponse => {
      const related = relatedResponse.products || [];
      if (related.length) {
        body.insertAdjacentHTML("beforeend", `
          <div class="related-products">
            <h4>You may also like</h4>
            <div class="products-grid related-grid">${related.map(productCard).join("")}</div>
          </div>`);
        body.querySelector(".related-grid")?.addEventListener("click", onGridClick);
      }
    })
    .catch(error => console.error("load related products:", error));

  // Wire up qty buttons
  $("detailDecBtn")?.addEventListener("click", () => {
    if (detailQty>1) { detailQty--; const v=$("detailQtyVal"); if(v) v.textContent=detailQty; }
  });
  $("detailIncBtn")?.addEventListener("click", () => {
    if (detailQty<stock) { detailQty++; const v=$("detailQtyVal"); if(v) v.textContent=detailQty; }
    else toast(`Only ${stock} available.`,"warning");
  });

  // Add to cart
  $("detailAddCartBtn")?.addEventListener("click", () => {
    addToCart(productId, detailQty);
    closeProductModal();
    openCart();
  });

  // Wishlist
  $("detailWishlistBtn")?.addEventListener("click", () => toggleWishlist(productId));

  // Star picker
  $("starPicker")?.addEventListener("click", e => {
    const btn = e.target.closest("button[data-star]");
    if (!btn) return;
    reviewStarVal = Number(btn.dataset.star);
    $$("#starPicker button").forEach(b => b.classList.toggle("active", Number(b.dataset.star)<=reviewStarVal));
  });

  // Submit review
  $("submitReviewBtn")?.addEventListener("click", async () => {
    const comment = $("reviewComment")?.value.trim() || "";
    const msgEl = $("reviewMessage");
    showMessage(msgEl,"","");
    const btn = $("submitReviewBtn");
    if (btn) { btn.disabled=true; btn.textContent="Submitting…"; }
    try {
      await api(`${API}/products/${productId}/reviews`,{
        method:"POST", body:JSON.stringify({ rating:reviewStarVal, comment })
      });
      if ($("reviewComment")) $("reviewComment").value="";
      showMessage(msgEl,"Review submitted! Thank you.","success");
      toast("Review submitted.","success");
      loadReviews(productId);
    } catch(err) { showMessage(msgEl, err.message,"error"); }
    finally { if(btn) { btn.disabled=false; btn.textContent="Submit Review"; } }
  });

  $("productOverlay")?.classList.add("active");
  document.body.style.overflow="hidden";

  // Load reviews async
  loadReviews(productId);
}

async function loadReviews(productId) {
  const list = $("reviewsList"); if (!list) return;
  try {
    const data = await api(`${API}/products/${productId}/reviews`);
    const reviews = data.reviews || [];
    if (!reviews.length) { list.innerHTML=`<p class="text-muted">No reviews yet. Be the first!</p>`; return; }
    list.innerHTML = reviews.map(r=>`
      <div class="review-item">
        <div class="review-header">
          <span class="review-author">${esc(r.reviewer_name)}${r.verified_purchase ? ` <span class="verified-review">✓ Verified purchase</span>` : ""}</span>
          <span class="review-date">${fmtDate(r.created_at)}</span>
        </div>
        <div class="stars" style="margin-bottom:6px">${starsHtml(r.rating)}</div>
        ${r.comment ? `<p class="review-comment">${esc(r.comment)}</p>` : ""}
      </div>`).join("");
  } catch { list.innerHTML=`<p class="text-muted">Could not load reviews.</p>`; }
}

function closeProductModal() {
  $("productOverlay")?.classList.remove("active");
  document.body.style.overflow="";
}

$("closeProduct")?.addEventListener("click", closeProductModal);
$("productOverlay")?.addEventListener("click", e => { if(e.target===$("productOverlay")) closeProductModal(); });

// ============================================================
// WISHLIST PANEL in account modal
// ============================================================

$("accountOverlay")?.addEventListener("click", e => {
  const btn = e.target.closest("[data-action='wishlist']");
  if (btn) toggleWishlist(Number(btn.dataset.productId));
});

// ============================================================
// NEWSLETTER
// ============================================================

$("newsletterForm")?.addEventListener("submit", e => {
  e.preventDefault();
  const email = $("newsletterEmail")?.value.trim()||"";
  if (!email||!email.includes("@")) { toast("Please enter a valid email.","warning"); return; }
  toast(`Thanks for subscribing with ${email}!`, "success", "Subscribed!");
  $("newsletterForm").reset();
});

// ============================================================
// HERO DEALS BUTTON
// ============================================================

$("heroDealBtn")?.addEventListener("click", e => {
  e.preventDefault();
  currentSort = "price-low";
  const ss=$("sortSelect"); if(ss) ss.value="price-low";
  loadProducts();
  $("products")?.scrollIntoView({ behavior:"smooth", block:"start" });
});

// ============================================================
// ESCAPE KEY — close top-most modal
// ============================================================

document.addEventListener("keydown", e => {
  if (e.key!=="Escape") return;
  if ($("productOverlay")?.classList.contains("active"))  { closeProductModal(); return; }
  if ($("checkoutOverlay")?.classList.contains("active")) { closeCheckoutModal(); return; }
  if ($("authOverlay")?.classList.contains("active"))     { closeAuthModal(); return; }
  if ($("accountOverlay")?.classList.contains("active"))  { closeAccountModal(); return; }
  if ($("cartSidebar")?.classList.contains("active"))     { closeCartSidebar(); return; }
});

// ============================================================
// BACK TO TOP
// ============================================================

window.addEventListener("scroll", () => {
  const btn = $("backToTop");
  if (btn) btn.style.display = window.scrollY > 400 ? "" : "none";
}, { passive:true });

$("backToTop")?.addEventListener("click", () => window.scrollTo({ top:0, behavior:"smooth" }));

// ============================================================
// MOBILE MENU
// ============================================================

$("mobileMenuBtn")?.addEventListener("click", () => {
  const nav=$("categoryNav");
  if (nav) nav.classList.toggle("mobile-open");
});

// ============================================================
// TAB VISIBILITY — refresh stock
// ============================================================

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState==="visible") loadProducts();
});

// ============================================================
// INIT
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  normalizeCart();
  restoreSession();
  loadProducts();
  renderCart();
  updateCheckoutTotals();
});

// ============================================================
// PAYMENT METHOD TOGGLE — update button label
// ============================================================
$("payWithCardCheckbox")?.addEventListener("change", () => {
  const btn = $("placeOrderButton");
  if (!btn) return;
  btn.textContent = $("payWithCardCheckbox").checked
    ? "Place Order & Pay with Card →"
    : "Place Order";
});
