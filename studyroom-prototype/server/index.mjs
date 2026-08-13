/**
 * 독립 실행 서버 — EC2 배포용.
 *   node server/index.mjs
 * 개발 중에는 Vite 미들웨어가 같은 핸들러를 쓰므로 이 파일이 필요 없다.
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
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
  if (url.startsWith('/assets/') || url.startsWith('/mediapipe/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }
  res.end(readFileSync(file))
}).listen(PORT, () => console.log(`http://127.0.0.1:${PORT}  (API + 정적파일)`))
