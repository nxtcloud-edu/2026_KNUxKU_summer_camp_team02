/**
 * 독립 실행 서버 — EC2 배포용.
 *   node server/index.mjs
 * 개발 중에는 Vite 미들웨어가 같은 핸들러를 쓰므로 이 파일이 필요 없다.
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apiHandler } from './middleware.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(root, 'dist')
const PORT = Number(process.env.PORT || 8080)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2',
}

createServer(async (req, res) => {
  if (await apiHandler(req, res)) return

  // 정적 파일 (빌드 결과)
  const url = (req.url || '/').split('?')[0]
  let file = join(DIST, url === '/' ? 'index.html' : url.replace(/^\/+/, ''))
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
