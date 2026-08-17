// packages/shell/src/loadMicrofrontend.js
//
// El shell no importa código de los microfrontends en tiempo de build —
// eso rompería la independencia de despliegue (el shell tendría que
// reconstruirse cada vez que mf-admin cambia). En su lugar, inyecta un
// <script> en tiempo de ejecución, apuntando a la URL donde ese
// microfrontend esté desplegado, y espera a que se registre su global
// (window.__MF_X__) antes de montarlo.
//
// En desarrollo, cada microfrontend corre en su propio servidor Vite
// (puertos 5174/5175/5176) sirviendo su entrada como módulo ES. En
// producción, cada uno se compila a un bundle IIFE autónomo (ver
// vite.config.js de cada paquete) servido desde su propia URL de
// despliegue, configurable por variable de entorno.

const loadedScripts = new Map();

function loadScript(url, isModule) {
  if (loadedScripts.has(url)) return loadedScripts.get(url);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    if (isModule) script.type = "module";
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`No se pudo cargar el microfrontend: ${url}`));
    document.body.appendChild(script);
  });

  loadedScripts.set(url, promise);
  return promise;
}

function waitForGlobal(globalName, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window[globalName]) return resolve(window[globalName]);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timeout esperando ${globalName}`));
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * Carga (si hace falta) y monta un microfrontend en un contenedor DOM.
 *
 * @param {object} config
 * @param {string} config.devUrl   URL del entry ESM en dev (servidor Vite propio)
 * @param {string} config.prodUrl  URL del bundle IIFE en producción
 * @param {string} config.globalName  Nombre del global expuesto, p. ej. "__MF_TV__"
 * @param {HTMLElement} container
 * @param {object} props  Props a pasar al mount() del microfrontend
 */
export async function loadMicrofrontend({ devUrl, prodUrl, globalName }, container, props) {
  const isDev = import.meta.env.DEV;
  const url = isDev ? devUrl : prodUrl;

  await loadScript(url, isDev);
  const mf = await waitForGlobal(globalName);
  mf.mount(container, props);

  return () => mf.unmount(container);
}
