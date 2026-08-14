/**
 * 독립 실행 서버 — EC2 배포용.
 *   node server/index.mjs
 * 개발 중에는 Vite 미들웨어가 같은 핸들러를 쓰므로 이 파일이 필요 없다.
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiHandler } from './middleware.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(root, 'dist')
const PORT = Number(process.env.PORT || 8080)

/**
 * ⚠️ 여기 빠진 확장자는 application/octet-stream 으로 나간다.
 *    브라우저는 **자바스크립트 MIME 이 아닌 모듈 워커를 실행 거부**한다.
 *    실제로 `.mjs` 가 빠져 있어서 pdf.js 워커가 안 떴고, PDF 열기가 통째로 실패했다.
 *    Vite 개발 서버는 알아서 붙여 주므로 로컬에서는 멀쩡했다 —
 *    개발과 배포가 갈리지 않게 하려고 만든 파일에서 정확히 그 일이 났다.
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
}

createServer(async (req, res) => {
  if (await apiHandler(req, res)) return

  // 정적 파일 (빌드 결과)
  const url = (req.url || '/').split('?')[0]

  /**
   * **주소를 디코딩한 뒤에 파일을 찾는다.**
   *
   * req.url 은 퍼센트 인코딩된 채로 온다. 파일 이름에 공백이나 한글이 들어 있으면
   * `/alongside%20%EC%83%81%EC%A0%90/...` 로 도착하는데, 그대로 디스크에서 찾으면
   * 당연히 없다. 그러면 아래 SPA 폴백에 걸려 **index.html 이 이미지 자리에 나간다.**
   * 브라우저에는 200 이 뜨고 깨진 이미지만 보인다 — 404 보다 알아채기 어렵다.
   * (실제로 상점 이미지 15개와 로고가 전부 877바이트짜리 index.html 을 받고 있었다.
   *  폴더 이름이 "alongside 상점" 이라 공백이 하나 있었다.)
   */
  let pathname
  try {
    pathname = decodeURIComponent(url)
  } catch {
    pathname = url // 잘못된 인코딩이면 원문 그대로 두고 아래에서 못 찾게 한다
  }

  let file = join(DIST, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''))

  /**
   * 디코딩을 열어 준 대가로 경로 탈출을 막아야 한다.
   * `%2e%2e%2f` 는 디코딩되면 `../` 가 된다 — 디코딩 전에는 없던 공격면이다.
   */
  if (!resolve(file).startsWith(resolve(DIST))) file = join(DIST, 'index.html')

  if (!existsSync(file) || !extname(file)) file = join(DIST, 'index.html') // SPA 폴백
  if (!existsSync(file)) {
    res.statusCode = 404
    return res.end('not found')
  }
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream')

  /**
   * 자산 파일 이름에는 내용 해시가 붙는다 (index-fxg5XsTU.js). 내용이 바뀌면 이름이 바뀌므로
   * 영원히 캐시해도 안전하다.
   *
   * **index.html 은 정반대다.** 이름이 고정이고 안에 그 해시를 담고 있다.
   * 캐시 지시를 안 주면 브라우저가 알아서 오래 들고 있다가, 배포한 뒤에도
   * 옛 index.html 로 옛 번들을 계속 부른다. 서버는 최신인데 화면만 옛것인 상태가 된다.
   * 실제로 그렇게 당했다 — 헤더가 content-type 하나뿐이었다.
   */
  if (url.startsWith('/assets/') || url.startsWith('/mediapipe/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  } else {
    res.setHeader('Cache-Control', 'no-cache') // 캐시는 하되 쓸 때마다 서버에 확인한다
  }

  const body = readFileSync(file)
  // 바뀌지 않았으면 304 로 끝낸다. no-cache 여도 재전송은 피한다
  const tag = `W/"${body.length.toString(16)}-${statSync(file).mtimeMs.toString(36)}"`
  res.setHeader('ETag', tag)
  if (req.headers['if-none-match'] === tag) {
    res.statusCode = 304
    return res.end()
  }
  res.end(body)
}).listen(PORT, () => console.log(`http://127.0.0.1:${PORT}  (API + 정적파일)`))
