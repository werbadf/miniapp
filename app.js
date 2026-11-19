(() => {
  "use strict";

  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const API = ((window.APP_CONFIG && window.APP_CONFIG.API_BASE) || "").replace(/\/$/, "");
  const INIT_DATA = tg ? tg.initData : "";
  const state = { config: null, me: null };

  const ERRORS = {
    not_found: "Не найдено",
    out_of_stock: "Товар закончился",
    balance: "Не хватает средств на балансе. Пополните баланс.",
    bad_amount: "Некорректная сумма",
    disabled: "Пополнение пока отключено",
    invoice_failed: "Не удалось создать счёт, попробуйте позже",
    used: "Вы уже использовали этот промокод",
    limit: "Лимит использований промокода исчерпан",
    expired: "Срок действия промокода истёк",
    inactive: "Промокод отключён",
    auth: "Откройте магазин из Telegram",
    banned: "Доступ ограничен",
    check_failed: "Не удалось проверить оплату",
    network: "Нет связи с сервером. Проверьте интернет.",
  };

  class ApiError extends Error {
    constructor(code, data) {
      super(code);
      this.code = code;
      this.data = data;
    }
  }

  const $ = (id) => document.getElementById(id);

  async function api(path, options = {}) {
    const init = { method: options.method || "GET", headers: { "X-Telegram-Init-Data": INIT_DATA } };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    let res;
    let data;
    try {
      res = await fetch(API + path, init);
      data = await res.json();
    } catch (e) {
      throw new ApiError("network", {});
    }
    if (!res.ok || !data.ok) throw new ApiError((data && data.error) || "http", data);
    return data;
  }

  function errText(e) {
    return ERRORS[e.code] || `Ошибка: ${e.code}`;
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function money(x) {
    const amount = Number(x).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
    return `${amount} ${state.config ? state.config.currency : ""}`.trim();
  }

  function fmtDate(ts) {
    return new Date(ts * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  }

  function toast(text) {
    const node = $("toast");
    node.textContent = text;
    node.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add("hidden"), 2500);
  }

  function view(...nodes) {
    $("view").replaceChildren(...nodes.flat());
  }

  function loading() {
    view(el("p", { class: "hint" }, "Загрузка…"));
  }

  function errorView(e) {
    view(
      el("p", { class: "error" }, errText(e)),
      el("button", { class: "btn secondary", onclick: () => route() }, "Повторить"),
    );
  }

  function openModal(node) {
    $("modal-body").replaceChildren(node);
    $("modal").classList.remove("hidden");
  }

  function closeModal() {
    $("modal").classList.add("hidden");
  }

  function confirmAsync(text) {
    return new Promise((resolve) => {
      if (tg && tg.showConfirm) tg.showConfirm(text, (ok) => resolve(Boolean(ok)));
      else resolve(window.confirm(text));
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Скопировано");
    } catch (e) {
      toast("Не удалось скопировать");
    }
  }

  function setTabs(page) {
    document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === page));
  }

  function deliveryHint(dtype) {
    if (dtype === "items") return "После оплаты вы получите одну позицию из списка.";
    if (dtype === "text") return "После оплаты вы сразу получите текст.";
    return "После оплаты файл придёт в чат с ботом.";
  }

  async function refreshMe() {
    state.me = await api("/api/me");
    $("balance").textContent = money(state.me.balance);
  }

  // ---------- магазин ----------

  async function renderShop() {
    loading();
    try {
      const { categories } = await api("/api/catalog");
      if (!categories.length) return view(el("p", { class: "hint" }, "Пока здесь пусто."));
      view(categories.map((c) => el("a", { class: "card", href: `#/cat/${c.id}` },
        el("div", { class: "grow" },
          el("div", { class: "title" }, c.name),
          el("div", { class: "meta" }, `Товаров: ${c.products.length}`)))));
    } catch (e) {
      errorView(e);
    }
  }

  async function renderCategory(id) {
    loading();
    try {
      const { categories } = await api("/api/catalog");
      const cat = categories.find((c) => c.id === id);
      if (!cat) return view(el("p", { class: "hint" }, "Категория не найдена."));
      view(
        el("h2", {}, cat.name),
        cat.products.length
          ? cat.products.map(productCard)
          : el("p", { class: "hint" }, "В этой категории пока нет товаров."),
      );
    } catch (e) {
      errorView(e);
    }
  }

  function productCard(p) {
    const stockText = p.stock === 0 ? "нет в наличии" : p.stock === null ? "в наличии" : `осталось ${p.stock}`;
    return el("a", { class: "card", href: `#/product/${p.id}` },
      p.has_media && p.media_type !== "video"
        ? el("img", { class: "thumb", src: `${API}/api/media/product/${p.id}`, alt: "", loading: "lazy" })
        : null,
      el("div", { class: "grow" },
        el("div", { class: "title" }, p.name),
        el("div", { class: "meta" }, stockText)),
      el("div", { class: "price" }, money(p.price)));
  }

  async function renderProduct(id) {
    loading();
    try {
      const { product: p } = await api(`/api/product/${id}`);
      const mediaUrl = `${API}/api/media/product/${p.id}`;
      const media = p.has_media
        ? (p.media_type === "video"
          ? el("video", { class: "media", src: mediaUrl, controls: true, playsinline: true })
          : el("img", { class: "media", src: mediaUrl, alt: "" }))
        : null;
      const out = p.stock === 0;
      const stockText = out ? "Нет в наличии" : p.stock === null ? "В наличии" : `Осталось: ${p.stock}`;
      view(
        media,
        el("h2", {}, p.name),
        el("div", { class: "price" }, money(p.price)),
        p.description ? el("div", { class: "desc" }, p.description) : null,
        el("div", { class: "meta" }, stockText),
        el("div", { class: "meta" }, deliveryHint(p.dtype)),
        el("button", { class: "btn", disabled: out, onclick: () => buy(p) },
          out ? "Нет в наличии" : `Купить за ${money(p.price)}`),
      );
    } catch (e) {
      errorView(e);
    }
  }

  async function buy(p) {
    const ok = await confirmAsync(`Купить «${p.name}» за ${money(p.price)}?`);
    if (!ok) return;
    try {
      const { order, balance } = await api("/api/buy", { method: "POST", body: { product_id: p.id } });
      $("balance").textContent = money(balance);
      showOrder(order);
    } catch (e) {
      if (e.code === "balance") {
        toast(errText(e));
        location.hash = "#/topup";
      } else {
        toast(errText(e));
      }
    }
  }

  function showOrder(order) {
    const nodes = [
      el("h2", {}, "Заказ оплачен"),
      el("div", { class: "meta" }, `Заказ № ${order.id} · код ${order.order_code}`),
      el("div", { class: "meta" }, `Списано: ${money(order.price)}`),
    ];
    if (order.data) {
      nodes.push(el("div", { class: "data" }, order.data));
      nodes.push(el("button", { class: "btn", onclick: () => copyText(order.data) }, "Скопировать"));
    } else {
      nodes.push(el("p", {}, "Файл отправлен вам в чат с ботом."));
    }
    nodes.push(el("button", { class: "btn secondary", onclick: closeModal }, "Закрыть"));
    openModal(el("div", {}, ...nodes));
    route();
  }

  // ---------- профиль ----------

  async function renderProfile() {
    loading();
    try {
      await refreshMe();
      const { orders } = await api("/api/orders");
      const me = state.me;
      const input = el("input", { id: "promo-input", placeholder: "Промокод", autocapitalize: "characters", autocomplete: "off" });
      view(
        el("h2", {}, `Баланс: ${money(me.balance)}`),
        el("div", { class: "meta" }, `Покупок: ${me.purchases}`),

        el("div", { class: "section-title" }, "Промокод"),
        me.promo
          ? el("div", { class: "card" },
            el("div", { class: "grow" },
              el("div", { class: "title" }, me.promo.code),
              el("div", { class: "meta" }, me.promo.text)),
            el("button", { class: "btn small secondary", onclick: promoOff }, "Отменить"))
          : null,
        el("div", { class: "row" },
          input,
          el("button", { class: "btn small", onclick: () => applyPromo(input.value) }, "Применить")),

        el("div", { class: "section-title" }, "Мои покупки"),
        orders.length
          ? orders.map(orderCard)
          : el("p", { class: "hint" }, "Вы пока ничего не покупали."),
      );
    } catch (e) {
      errorView(e);
    }
  }

  function orderCard(o) {
    return el("button", { class: "card", onclick: () => showOrderDetails(o) },
      el("div", { class: "grow" },
        el("div", { class: "title" }, o.product_name),
        el("div", { class: "meta" }, `№${o.id} · ${fmtDate(o.created_at)}`)),
      el("div", { class: "price" }, money(o.price)));
  }

  function showOrderDetails(o) {
    const nodes = [
      el("h2", {}, o.product_name),
      el("div", { class: "meta" }, `Заказ № ${o.id} · код ${o.order_code}`),
    ];
    if (o.data) {
      nodes.push(el("div", { class: "data" }, o.data));
      nodes.push(el("button", { class: "btn", onclick: () => copyText(o.data) }, "Скопировать"));
    }
    if (o.file) {
      nodes.push(el("button", { class: "btn", onclick: () => resendOrder(o.id) }, "Отправить файл в чат"));
    }
    if (!o.data && !o.file) nodes.push(el("p", { class: "hint" }, "Данные недоступны."));
    nodes.push(el("button", { class: "btn secondary", onclick: closeModal }, "Закрыть"));
    openModal(el("div", {}, ...nodes));
  }

  async function resendOrder(id) {
    try {
      await api(`/api/orders/${id}/resend`, { method: "POST" });
      closeModal();
      toast("Файл отправлен в чат с ботом");
    } catch (e) {
      toast(errText(e));
    }
  }

  async function applyPromo(raw) {
    const code = (raw || "").trim();
    if (!code) return toast("Введите промокод");
    try {
      const d = await api("/api/promo", { method: "POST", body: { code } });
      toast(d.kind === "balance"
        ? `Зачислено ${money(d.value)}`
        : `Скидка ${d.value}% на следующую покупку`);
      route();
    } catch (e) {
      toast(errText(e));
    }
  }

  async function promoOff() {
    try {
      await api("/api/promo/off", { method: "POST" });
      toast("Промокод отменён");
      route();
    } catch (e) {
      toast(errText(e));
    }
  }

  // ---------- пополнение ----------

  async function renderTopup() {
    loading();
    try {
      await refreshMe();
      const c = state.config;
      if (!c.topup_enabled) {
        return view(
          el("p", {}, "Автопополнение пока не подключено. Напишите в поддержку."),
          supportButton(),
        );
      }
      const input = el("input", { id: "amount", inputmode: "decimal", placeholder: `Сумма от ${c.min_topup}` });
      view(
        el("h2", {}, `Баланс: ${money(state.me.balance)}`),
        el("div", { class: "section-title" }, "Выберите сумму"),
        el("div", { class: "grid-presets" },
          c.presets.map((a) => el("button", { class: "btn secondary", onclick: () => topup(a) }, money(a)))),
        el("div", { class: "section-title" }, "Или своя сумма"),
        el("div", { class: "row" },
          input,
          el("button", { class: "btn small", onclick: () => topup(Number(input.value.replace(",", "."))) }, "Оплатить")),
        el("p", { class: "hint" }, "Оплата криптовалютой через Crypto Bot. Баланс пополнится после оплаты."),
        supportButton(),
      );
    } catch (e) {
      errorView(e);
    }
  }

  function supportButton() {
    const url = state.config && state.config.support_url;
    if (!url) return null;
    return el("button", { class: "btn secondary", onclick: () => (tg ? tg.openLink(url) : window.open(url, "_blank")) },
      "Написать в поддержку");
  }

  async function topup(amount) {
    if (!amount || amount < state.config.min_topup) {
      return toast(`Минимальная сумма: ${money(state.config.min_topup)}`);
    }
    try {
      const d = await api("/api/topup", { method: "POST", body: { amount } });
      if (tg) tg.openLink(d.url);
      else window.open(d.url, "_blank");
      openModal(el("div", {},
        el("h2", {}, "Счёт создан"),
        el("p", {}, "Оплатите счёт в Crypto Bot и нажмите «Проверить оплату»."),
        el("button", { class: "btn", onclick: () => checkPayment(d.payment_id) }, "Проверить оплату"),
        el("button", { class: "btn secondary", onclick: closeModal }, "Закрыть"),
      ));
    } catch (e) {
      toast(errText(e));
    }
  }

  async function checkPayment(id) {
    try {
      const d = await api(`/api/topup/${id}`);
      if (d.status === "paid") {
        closeModal();
        toast("Оплата получена, баланс пополнен");
        route();
      } else if (d.status === "expired") {
        closeModal();
        toast("Счёт истёк, создайте новый");
      } else {
        toast("Оплата пока не поступила, подождите минуту");
      }
    } catch (e) {
      toast(errText(e));
    }
  }

  // ---------- маршруты и запуск ----------

  function route() {
    const [page, rawId] = (location.hash || "#/shop").replace(/^#\//, "").split("/");
    const id = Number(rawId);
    setTabs(page === "cat" || page === "product" ? "shop" : page);
    if (tg) {
      if (page === "shop" || !page) tg.BackButton.hide();
      else tg.BackButton.show();
    }
    if (page === "cat") return renderCategory(id);
    if (page === "product") return renderProduct(id);
    if (page === "profile") return renderProfile();
    if (page === "topup") return renderTopup();
    return renderShop();
  }

  function applyTheme(params) {
    const style = document.documentElement.style;
    for (const [key, value] of Object.entries(params || {})) {
      style.setProperty(`--tg-theme-${key.replace(/_/g, "-")}`, value);
    }
  }

  async function init() {
    if (tg) {
      tg.ready();
      tg.expand();
      applyTheme(tg.themeParams);
      tg.onEvent("themeChanged", () => applyTheme(tg.themeParams));
      tg.BackButton.onClick(() => history.back());
    }
    $("modal-close").addEventListener("click", closeModal);
    $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

    if (!API) {
      return view(el("p", { class: "error" }, "Не задан адрес сервера в config.js (API_BASE)."));
    }
    try {
      state.config = await api("/api/config");
      await refreshMe();
    } catch (e) {
      return errorView(e);
    }
    window.addEventListener("hashchange", route);
    route();
  }

  init();
})();
