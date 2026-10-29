/** Keep stored sticker paths portable; apply the hosting prefix only when rendering. */
export function appUrl(path: string, base = import.meta.env.BASE_URL): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\/+/, '');
}

export function isScreenPath(pathname: string, base = import.meta.env.BASE_URL): boolean {
  const prefix = base.replace(/\/$/, '');
  const localPath = prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))
    ? pathname.slice(prefix.length) : pathname;
  return localPath === '/screen' || localPath.startsWith('/screen/');
}
