/* ZimaOS Network Manager · v0.3.10 — interface visual, sem bibliotecas externas. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { readRequiresToken: false, devices: [], route: null, status: null, health: null, networks: [], hotspots: [], errors: {} };
  const labels = {
    overview: ['Visão geral', 'Acompanhe suas conexões e os dispositivos disponíveis, sem informações complicadas.'],
    devices: ['Dispositivos', 'Veja as placas de rede detectadas e o que cada uma consegue fazer.'],
    wifi: ['Redes Wi-Fi', 'Procure redes próximas e conecte-se à que você escolher.'],
    hotspot: ['Hotspot', 'Veja, pare ou crie pontos de acesso Wi-Fi.'],
    share: ['Compartilhar internet', 'Entenda qual conexão fornece a internet para o hotspot.'],
    ip: ['Endereços IP', 'Consulte endereços IPv4, IPv6, gateway e DNS de cada placa.'],
    status: ['Diagnóstico', 'Confira o estado do NetworkManager e as conexões ativas.'],
    settings: ['Acesso administrativo', 'Informe o token necessário para alterar as conexões.']
  };
  const ico = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Avisos e confirmações são renderizados pelo próprio painel, sem caixas nativas.
  function toast(message, type = 'ok') {
    const el = $('toast');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = type === 'error' ? '×' : type === 'warn' ? '!' : '✓';
    const content = document.createElement('div');
    content.className = 'toast-message';
    content.textContent = String(message);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Fechar mensagem');
    close.textContent = '×';
    close.addEventListener('click', () => { clearTimeout(toast.timer); el.className = 'toast'; });
    el.replaceChildren(icon, content, close);
    el.className = 'toast show' + (type === 'ok' ? '' : ` ${type}`);
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    clearTimeout(toast.timer);
    // Erros permanecem visíveis até a pessoa fechá-los.
    if (type !== 'error') toast.timer = setTimeout(() => { el.className = 'toast'; }, type === 'warn' ? 9000 : 5500);
  }

  let confirmResolve = null;
  let focusBeforeConfirm = null;
  function closePanelConfirm(accepted) {
    if (!confirmResolve) return;
    const done = confirmResolve;
    confirmResolve = null;
    $('panelConfirm').hidden = true;
    document.body.classList.remove('dialog-open');
    if (focusBeforeConfirm?.isConnected && typeof focusBeforeConfirm.focus === 'function') focusBeforeConfirm.focus();
    focusBeforeConfirm = null;
    done(accepted);
  }
  function panelConfirm(message, action) {
    if (confirmResolve) return Promise.resolve(false);
    const actions = {
      connect: ['Conectar ao Wi-Fi?', 'Conectar', false],
      disconnect: ['Desconectar esta placa?', 'Desconectar', true],
      hotspot: ['Criar e ativar hotspot?', 'Criar hotspot', false],
      'hotspot/stop': ['Parar este hotspot?', 'Parar hotspot', true]
    };
    const [title, button, danger] = actions[action] || ['Confirmar alteração?', 'Confirmar', true];
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    $('confirmAccept').textContent = button;
    $('confirmAccept').className = 'button ' + (danger ? 'button-danger' : 'button-primary');
    focusBeforeConfirm = document.activeElement;
    $('panelConfirm').hidden = false;
    document.body.classList.add('dialog-open');
    $('confirmCancel').focus();
    return new Promise(resolve => { confirmResolve = resolve; });
  }
  function confirmKeyboard(event) {
    if ($('panelConfirm').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closePanelConfirm(false); return; }
    if (event.key !== 'Tab') return;
    const items = [$('confirmClose'), $('confirmCancel'), $('confirmAccept')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  const active = (d) => String(d?.state || '').toLowerCase().startsWith('connected');
  const physical = (d) => d.type === 'wifi' || d.type === 'ethernet';
  const isWifi = (d) => d.type === 'wifi';
  const isHotspot = (d) => state.hotspots.some(h => h.device === d.device);
  const shortState = (d) => {
    if (active(d)) return ['Conectado', 'ok'];
    if (d.state === 'unavailable') return ['Indisponível', 'warn'];
    if (d.state === 'disconnected') return ['Desconectado', 'warn'];
    if (d.state === 'unmanaged') return ['Não gerenciado', 'warn'];
    return ['Desconectado', 'warn'];
  };
  const typeName = (d) => isWifi(d) ? 'Wi-Fi' : d.type === 'ethernet' ? 'Ethernet (cabo)' : d.type;
  const driverLabel = (d) => !d.driver || d.driver === 'não identificado' || d.driver === 'driver' ? 'Não identificado' : d.driver;
  function badge(d) { const [label, kind] = shortState(d); return `<span class="pill ${kind}">${label}</span>`; }
  function iconFor(d) { return isWifi(d) ? 'wifi' : 'ethernet'; }
  function symbol(d) { return `<span class="device-symbol ${isWifi(d) ? '' : 'ethernet'}">${ico(iconFor(d))}</span>`; }
  function apLabel(d) {
    if (!isWifi(d)) return 'Não aplicável';
    if (String(d.ap).startsWith('sim')) return 'Hotspot suportado pelo driver';
    if (String(d.ap).startsWith('não (')) return 'Hotspot não anunciado pelo driver';
    return 'Compatibilidade ainda não verificada';
  }
  function wifiConnected() { return state.devices.find(d => isWifi(d) && active(d)) || null; }
  function defaultRoute() {
    const route = state.route?.route || '';
    return { raw: route, iface: /(?:^|\s)dev\s+(\S+)/.exec(route)?.[1] || '', via: /(?:^|\s)via\s+(\S+)/.exec(route)?.[1] || '' };
  }
  async function api(path, options = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), options.method === 'POST' ? 45000 : 13000);
    try {
      const headers = { ...(options.headers || {}) };
      if (getToken()) headers['X-Panel-Token'] = getToken();
      const r = await fetch('/api/' + path, { ...options, headers, signal: controller.signal, cache: 'no-store' });
      let data;
      try { data = await r.json(); } catch { throw new Error(`Resposta inválida do servidor (HTTP ${r.status}).`); }
      if (!r.ok) {
        const detail = data?.detail;
        throw new Error(typeof detail === 'string' ? detail : `Servidor respondeu HTTP ${r.status}.`);
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('O servidor demorou demais para responder.');
      throw e;
    } finally { clearTimeout(t); }
  }
  function navigate(page) {
    if (!labels[page]) return;
    document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
    document.querySelectorAll('.nav-link').forEach(el => {
      const activeNow = el.dataset.page === page;
      el.classList.toggle('active', activeNow);
      el.setAttribute('aria-current', activeNow ? 'page' : 'false');
    });
    $('pageTitle').textContent = labels[page][0];
    $('currentPageLabel').textContent = labels[page][0];
    $('pageSubtitle').textContent = labels[page][1];
    $('sidebar').classList.remove('open');
    $('mobileShade').classList.remove('visible');
    if (page === 'wifi') loadWifi();
    if (page === 'hotspot') loadHotspots();
    if (page === 'ip') loadIp();
    if (page === 'status') loadHealth();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderOverview() {
    const wifi = wifiConnected();
    const real = state.devices.filter(physical);
    const route = defaultRoute();
    const statusLine = String(state.status?.general || '').split(':')[0].toLowerCase();
    const routeOk = Boolean(route.iface);
    $('metricInternet').textContent = routeOk ? 'Rota disponível' : (state.errors.route ? 'Indisponível' : 'Sem rota ativa');
    $('metricInternetDesc').textContent = routeOk ? `Saída por ${route.iface}` : 'Acesso à internet não confirmado';
    $('metricWifi').textContent = wifi ? (wifi.connection || wifi.device) : 'Não conectado';
    $('metricWifiDesc').textContent = wifi ? `Interface ${wifi.device}` : 'Nenhuma conexão Wi-Fi ativa';
    $('metricDevices').textContent = String(real.length);
    $('metricDevicesDesc').textContent = `${real.filter(isWifi).length} Wi-Fi · ${real.filter(d => d.type === 'ethernet').length} Ethernet`;
    $('metricHotspot').textContent = state.devices.some(isHotspot) ? 'Ativo' : 'Não detectado';
    $('metricHotspotDesc').textContent = 'Conexões identificadas pelo NM';
    $('overviewRouteName').textContent = route.iface || 'Nenhuma rota padrão';
    $('overviewRouteAddress').textContent = route.via ? `Gateway ${route.via}` : (route.raw || 'Não foi possível determinar a origem');
    const el = $('overviewDevices');
    el.innerHTML = real.length ? real.map(d => `<div class="device-row">${symbol(d)}<div class="device-row-main"><strong>${esc(typeName(d))} · ${esc(d.device)}</strong><small>${esc(d.connection || (isWifi(d) ? apLabel(d) : driverLabel(d)))}</small></div>${badge(d)}</div>`).join('') : `<div class="empty">${state.errors.devices ? esc(state.errors.devices) : 'Nenhuma placa de rede física detectada.'}</div>`;
    const top = $('topConnection');
    top.className = 'top-connection ' + (routeOk ? 'ok' : (state.errors.health || statusLine === 'disconnected' ? 'bad' : ''));
    top.innerHTML = `<i class="pulse"></i> ${routeOk ? 'Rota ativa' : 'Sem rota confirmada'}`;
  }
  function renderDevices() {
    const real = state.devices.filter(physical);
    $('physicalDevices').innerHTML = real.length ? real.map(d => `<article class="device-card"><div class="device-card-top"><div class="device-card-title">${symbol(d)}<div><strong>${esc(typeName(d))}</strong><small>${esc(d.device)}</small></div></div>${badge(d)}</div><div class="device-card-row"><span>Conexão atual</span><strong>${esc(d.connection || 'Nenhuma')}</strong></div><div class="device-card-row"><span>Driver da placa</span><strong>${esc(driverLabel(d))}</strong></div>${isWifi(d) ? `<div class="device-card-row"><span>Suporte a hotspot</span><strong>${esc(apLabel(d))}</strong></div><div class="device-card-row"><span>Wi-Fi + hotspot ao mesmo tempo</span><strong>Não verificado</strong></div><button class="mini-link" data-goto="wifi">${ico('wifi')} Procurar redes</button>` : `<div class="device-card-row"><span>Conexão por cabo</span><strong>${d.state === 'unavailable' ? 'Sem link ou indisponível' : active(d) ? 'Em uso' : 'Não conectada'}</strong></div>`}</article>`).join('') : `<div class="empty">${state.errors.devices ? esc(state.errors.devices) : 'Não foram encontradas placas físicas.'}</div>`;
    const virt = state.devices.filter(d => !physical(d));
    $('virtualCount').textContent = `(${virt.length})`;
    $('virtualDevices').innerHTML = virt.length ? virt.map(d => `<div class="virtual-row"><div><strong>${esc(d.device)}</strong><br><small>${esc(d.type)}</small></div>${badge(d)}</div>`).join('') : '<p class="hint">Nenhuma interface virtual encontrada.</p>';
  }
  function updateSelect(id, devices, placeholder) {
    const el = $(id); const prev = el.value;
    el.innerHTML = devices.length ? devices.map(d => `<option value="${esc(d.device)}">${esc(typeName(d))} — ${esc(d.device)}${active(d) ? ' (conectado)' : ''}</option>`).join('') : `<option value="">${esc(placeholder)}</option>`;
    if (devices.some(d => d.device === prev)) el.value = prev;
  }
  function updateControls() {
    const real = state.devices.filter(physical), wifi = real.filter(isWifi);
    updateSelect('wifiDevice', wifi, 'Nenhuma placa Wi-Fi');
    updateSelect('hotspotDevice', wifi, 'Nenhuma placa Wi-Fi');
    updateSelect('ipDevice', real, 'Nenhuma interface física');
    const scan = $('scanDevice'), was = scan.value;
    scan.innerHTML = '<option value="">Todas as placas Wi-Fi</option>' + wifi.map(d => `<option value="${esc(d.device)}">${esc(d.device)}${active(d) ? ' · conectada' : ''}</option>`).join('');
    if (wifi.some(d => d.device === was)) scan.value = was;
    $('hotspotForm').querySelector('button[type=submit]').disabled = !wifi.length;
    $('wifiForm').querySelector('button[type=submit]').disabled = !wifi.length;
    updateHotspotCapability();
  }
  async function loadDevices() {
    try { state.devices = await api('devices'); state.errors.devices = ''; }
    catch (e) { state.errors.devices = e.message; state.devices = []; }
    renderDevices(); updateControls(); renderOverview();
  }
  function renderNetworks() {
    const el = $('wifiNetworks');
    if (state.errors.wifi) { el.innerHTML = `<div class="empty">Não foi possível procurar redes.<br>${esc(state.errors.wifi)}</div>`; return; }
    if (!state.networks.length) { el.innerHTML = '<div class="empty">Nenhuma rede encontrada. Verifique se o Wi-Fi está ligado e tente novamente.</div>'; return; }
    el.innerHTML = state.networks.map((n, i) => `<button class="network-row ${n.inUse ? 'current' : ''}" type="button" data-network-index="${i}"><span class="network-icon">${ico('wifi')}</span><span class="network-body"><strong>${esc(n.ssid)} ${n.inUse ? '<span class="pill ok">Atual</span>' : ''}</strong><small>${esc(n.security && n.security !== '--' ? n.security : 'Rede aberta')} · ${n.signal}% de sinal</small></span><span class="network-bars">${signalText(n.signal)}</span>${ico('chevron')}</button>`).join('');
  }
  function signalText(signal) { return signal >= 75 ? 'Excelente' : signal >= 50 ? 'Bom' : signal >= 25 ? 'Médio' : 'Fraco'; }
  async function loadWifi() {
    $('wifiNetworks').innerHTML = '<div class="loading">Procurando redes disponíveis...</div>';
    const device = $('scanDevice').value;
    try {
      const data = await api('wifi' + (device ? '?device=' + encodeURIComponent(device) : ''));
      state.networks = Array.isArray(data.networks) ? data.networks : [];
      state.errors.wifi = '';
    } catch (e) { state.errors.wifi = e.message; state.networks = []; }
    renderNetworks();
  }
  function renderHotspots() {
    const el = $('activeHotspots');
    if (state.errors.hotspots) {
      el.innerHTML = `<div class="empty">Não foi possível verificar os hotspots: ${esc(state.errors.hotspots)}</div>`;
      return;
    }
    if (!state.hotspots.length) {
      el.innerHTML = '<div class="empty">Nenhum hotspot ativo encontrado. Hotspots desligados não aparecem nesta lista.</div>';
      return;
    }
    el.innerHTML = state.hotspots.map(h => `<div class="hotspot-entry">
      <span class="device-symbol">${ico('hotspot')}</span>
      <div class="hotspot-entry-info"><strong>${esc(h.ssid || h.name)}</strong>
        <small>${esc(h.device)} · ${h.managedByApp ? 'Criado pelo ZimaOS Network Manager' : 'Criado no Linux'}</small>
        <span class="pill ok">Ativo</span>
      </div>
      <button type="button" class="button button-danger hotspot-stop" data-stop-hotspot="${esc(h.uuid)}">${ico('alert')} Parar hotspot</button>
    </div>`).join('');
  }
  async function loadHotspots() {
    try {
      const data = await api('hotspots');
      state.hotspots = Array.isArray(data.hotspots) ? data.hotspots : [];
      state.errors.hotspots = '';
    } catch(e) {
      state.hotspots = [];
      state.errors.hotspots = e.message;
    }
    renderHotspots(); renderOverview();
  }
  function updateHotspotCapability() {
    const d = state.devices.find(x => x.device === $('hotspotDevice').value);
    const el = $('hotspotCapability');
    if (!d) { el.textContent = 'Nenhuma placa Wi-Fi disponível.'; el.className = 'capability caution'; return; }
    const available = String(d.ap).startsWith('sim');
    const unsupported = String(d.ap).startsWith('não (');
    const extra = active(d) ? ' Esta placa está conectada: ativar o hotspot pode derrubar a conexão.' : '';
    el.textContent = (available ? 'Driver anuncia suporte a hotspot.' : unsupported ? 'Driver não anuncia suporte a hotspot.' : 'Ainda não foi possível verificar suporte a hotspot.') + ' Uso simultâneo Wi-Fi + hotspot não confirmado.' + extra;
    el.className = 'capability ' + (available ? 'good' : 'caution');
  }
  function renderShare() {
    const r = defaultRoute();
    $('shareInterface').textContent = r.iface || 'Não identificada';
    $('shareGateway').textContent = r.via || 'Não identificado';
    $('shareSource').textContent = r.iface || 'Sem saída conhecida';
    $('statusRoute').textContent = r.iface ? `${r.iface}${r.via ? ' · ' + r.via : ''}` : (r.raw || 'Não identificada');
  }
  function ipCell(label, lines) {
    const values = Array.isArray(lines) ? lines : [lines];
    return `<div class="ip-item"><small>${esc(label)}</small>${values.filter(Boolean).length ? values.filter(Boolean).map(v => `<strong>${esc(v)}</strong>`).join('<p></p>') : '<strong>Não configurado</strong>'}</div>`;
  }
  async function loadIp() {
    const device = $('ipDevice').value;
    if (!device) { $('ipDetails').innerHTML = '<div class="empty">Nenhuma placa de rede encontrada.</div>'; return; }
    $('ipDetails').innerHTML = '<div class="loading">Consultando endereços IP...</div>';
    try {
      const d = await api('ip?device=' + encodeURIComponent(device));
      if ($('ipDevice').value !== device) return;
      $('ipDetails').innerHTML = ipCell('ENDEREÇO IPv4',d.ipv4)+ipCell('GATEWAY IPv4',d.gateway)+ipCell('SERVIDORES DNS',d.dns)+ipCell('ENDEREÇO IPv6',d.ipv6)+ipCell('GATEWAY IPv6',d.gateway6);
    } catch(e) { $('ipDetails').innerHTML = `<div class="empty">Não foi possível consultar os endereços desta placa: ${esc(e.message)}</div>`; }
  }
  function renderStatus() {
    const health = state.health;
    const failed = !!state.errors.health;
    const nmstate = health?.networkManagerState || '';
    const label = failed ? 'Serviço indisponível' : nmstate ? 'NetworkManager respondendo' : 'Sem informações';
    $('healthDisplay').className = 'health-display' + (failed ? ' bad' : '');
    $('healthDisplay').innerHTML = `<span class="health-icon">${ico(failed ? 'alert' : 'check')}</span><div><strong>${label}</strong><small>${esc(failed ? state.errors.health : `Estado: ${nmstate || 'indeterminado'} · v0.3.10`)}</small></div>`;
    const activeConnections = state.status?.connections || [];
    $('connectionsList').innerHTML = state.errors.status ? `<div class="empty">${esc(state.errors.status)}</div>` : activeConnections.length ? activeConnections.map(item => {
      const values = splitEscaped(item);
      return `<div class="connection-line"><strong>${esc(values[0] || 'Conexão')}</strong><small>Placa: ${esc(values[1] || '—')} · ${esc(values.slice(2).join(':') || 'Tipo não informado')}</small></div>`;
    }).join('') : '<div class="empty">Nenhuma conexão ativa informada.</div>';
  }
  function splitEscaped(input) {
    const parts = []; let out = '', slash = false;
    for (const ch of String(input)) {
      if (slash) { out += ch; slash = false; }
      else if (ch === '\\') slash = true;
      else if (ch === ':') { parts.push(out); out = ''; }
      else out += ch;
    }
    parts.push(out); return parts;
  }
  async function loadHealth() {
    const calls = [api('health').then(v => { state.health = v; state.errors.health = ''; }).catch(e => { state.health = null; state.errors.health = e.message; }),api('status').then(v => { state.status = v; state.errors.status = ''; }).catch(e => { state.status = null; state.errors.status = e.message; })];
    await Promise.all(calls); renderStatus(); renderOverview();
  }
  async function loadRoute() {
    try { state.route = await api('default-route'); state.errors.route = ''; }
    catch(e) { state.route = null; state.errors.route = e.message; }
    renderShare(); renderOverview();
  }
  async function refreshAll({ silent = false } = {}) {
    $('refreshAll').disabled = true;
    try {
      await Promise.all([loadDevices(), loadRoute(), loadHealth(), loadHotspots()]);
      $('lastSync').textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      const authError = Object.values(state.errors).some(v => /token de acesso|token inválido|HTTP 401|401/i.test(String(v || '')));
      if (authError && state.readRequiresToken) {
        navigate('settings');
        toast('Token incorreto ou ausente. Informe o token configurado no ZimaOS.', 'error');
        return;
      }
      if (!silent) toast('Informações atualizadas.');
    } finally { $('refreshAll').disabled = false; }
  }
  function getToken() { try { return sessionStorage.getItem('zima_nm_token') || ''; } catch { return tokenFallback; } }
  let tokenFallback = '';
  function setToken(value) { tokenFallback = value; try { if (value) sessionStorage.setItem('zima_nm_token', value); else sessionStorage.removeItem('zima_nm_token'); } catch { /* sessão indisponível */ } }
  function showTokenState() {
    const token = getToken();
    $('tokenState').textContent = token ? 'Token salvo nesta aba. Consultas protegidas e alterações autorizadas.' : (state.readRequiresToken ? 'Informe o token para consultar a rede deste servidor.' : 'Nenhum token configurado nesta aba.');
    $('tokenState').className = 'capability ' + (token ? 'good' : 'caution');
  }
  async function writeAction(action, payload, warning) {
    const token = getToken();
    if (!token) { toast('Informe seu token administrativo antes de modificar a rede.', 'warn'); navigate('settings'); $('adminToken').focus(); return; }
    if (!await panelConfirm(warning, action)) return;
    try {
      const result = await api(action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel-Token': token }, body: JSON.stringify(payload) });
      await refreshAll({ silent: true });
      toast(result.result || 'Operação concluída.');
      if (action === 'connect') await loadWifi();
    } catch(e) { toast('Não foi possível concluir: ' + e.message, 'error'); }
  }
  function bindEvents() {
    $('confirmCancel').addEventListener('click', () => closePanelConfirm(false));
    $('confirmClose').addEventListener('click', () => closePanelConfirm(false));
    $('confirmAccept').addEventListener('click', () => closePanelConfirm(true));
    document.addEventListener('keydown', confirmKeyboard);
    document.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.page)));
    document.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.goto)));
    $('menuBtn').addEventListener('click', () => { $('sidebar').classList.toggle('open'); $('mobileShade').classList.toggle('visible'); });
    $('mobileShade').addEventListener('click', () => { $('sidebar').classList.remove('open'); $('mobileShade').classList.remove('visible'); });
    $('refreshAll').addEventListener('click', refreshAll);
    document.querySelectorAll('[data-refresh]').forEach(btn => btn.addEventListener('click', async () => { if (btn.dataset.refresh === 'devices') await loadDevices(); else await loadHealth(); toast('Informações atualizadas.'); }));
    $('scanBtn').addEventListener('click', loadWifi);
    $('scanDevice').addEventListener('change', loadWifi);
    $('wifiNetworks').addEventListener('click', e => {
      const btn = e.target.closest('[data-network-index]'); if (!btn) return;
      const n = state.networks[Number(btn.dataset.networkIndex)]; if (!n) return;
      $('wifiSsid').value = n.ssid;
      if (n.inUse) toast('Esta rede já aparece como conectada.'); else { toast('Rede selecionada. Informe a senha, se necessário.'); $('wifiPassword').focus(); }
    });
    $('refreshHotspots').addEventListener('click', loadHotspots);
    $('activeHotspots').addEventListener('click', (event) => {
      const button = event.target.closest('[data-stop-hotspot]');
      if (!button || button.disabled) return;
      const h = state.hotspots.find(item => item.uuid === button.dataset.stopHotspot);
      if (!h) return;
      writeAction('hotspot/stop', { uuid: h.uuid },
        `Parar o hotspot “${h.ssid || h.name}” na placa ${h.device}?\nIsso desconectará os dispositivos conectados a ele e poderá interromper seu acesso remoto.`);
    });
    $('hotspotDevice').addEventListener('change', updateHotspotCapability);
    $('wifiForm').addEventListener('submit', e => {
      e.preventDefault();
      const device = $('wifiDevice').value;
      const ssid = $('wifiSsid').value.trim();
      if (!device) return toast('Selecione uma placa Wi-Fi.', 'warn');
      if (!ssid) return toast('Informe o nome da rede Wi-Fi.', 'warn');
      if (ssid.length > 128) return toast('O nome da rede ultrapassou 128 caracteres.', 'warn');
      writeAction('connect', { device, ssid, password: $('wifiPassword').value || null }, 'A conexão Wi-Fi atual pode ser interrompida.');
    });
    $('disconnectBtn').addEventListener('click', () => { if (!$('wifiDevice').value) return toast('Selecione uma placa Wi-Fi.', 'warn'); writeAction('disconnect',{device:$('wifiDevice').value},'Desconectar esta placa pode cortar o acesso ao computador.'); });
    $('hotspotForm').addEventListener('submit', e => {
      e.preventDefault();
      const device = $('hotspotDevice').value;
      const ssid = $('hotspotSsid').value.trim();
      const password = $('hotspotPassword').value;
      const utf8Bytes = value => new TextEncoder().encode(value).length;
      if (!device) return toast('Selecione a placa que transmitirá o hotspot.', 'warn');
      if (!ssid || utf8Bytes(ssid) > 32) return toast('O nome do hotspot deve ter entre 1 e 32 bytes.', 'warn');
      if (utf8Bytes(password) < 8 || utf8Bytes(password) > 63) return toast('A senha do hotspot deve ter entre 8 e 63 bytes.', 'warn');
      const d = state.devices.find(x => x.device === device);
      const warning = 'Ativar um hotspot pode interromper a rede atual' + (d && active(d) ? ', inclusive a conexão Wi-Fi usada neste momento' : '') + '.';
      writeAction('hotspot', { device, ssid, password }, warning);
    });
    $('ipDevice').addEventListener('change', loadIp);
    $('refreshIp').addEventListener('click', loadIp);
    document.querySelectorAll('[data-toggle-password]').forEach(btn => btn.addEventListener('click', () => { const el = $(btn.dataset.togglePassword); el.type = el.type === 'password' ? 'text' : 'password'; }));
    $('saveToken').addEventListener('click', () => { const token = $('adminToken').value.trim(); if (!token) return toast('Cole um token antes de salvar.', 'warn'); setToken(token); $('adminToken').value = ''; showTokenState(); toast('Token salvo. Verificando acesso à rede...'); refreshAll(); });
    $('clearToken').addEventListener('click', () => { setToken(''); $('adminToken').value = ''; showTokenState(); toast('Token apagado desta aba.'); if (state.readRequiresToken) navigate('settings'); });
  }
  bindEvents();
  (async () => {
    try { const cfg = await api('config'); state.readRequiresToken = Boolean(cfg.readRequiresToken); }
    catch (e) { toast('Não foi possível obter a configuração do painel: ' + e.message, 'error'); }
    showTokenState();
    if (state.readRequiresToken && !getToken()) {
      navigate('settings');
      toast('Este servidor exige token para mostrar os dados da rede.', 'warn');
    } else {
      await refreshAll();
    }
  })();
})();
