/**
 * MediaPipe WASM 런타임을 public/ 으로 복사한다.
 *
 * CDN에서 받아도 되지만 자체 호스팅하는 이유:
 *  · EC2 배포 후 외부 CDN이 막히거나 느려도 동작한다
 *  · 버전이 npm 의존성과 항상 일치한다 (CDN 버전 불일치 사고 방지)
 *  · 오프라인에서도 데모가 된다
 *
 * postinstall로 자동 실행된다.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const dest = join(root, 'public', 'mediapipe', 'wasm')

if (!existsSync(src)) {
  console.warn('[mediapipe] node_modules에 wasm이 없습니다. npm install 후 다시 실행하세요.')
  process.exit(0)
}

mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })

const total = readdirSync(dest).reduce((a, f) => a + statSync(join(dest, f)).size, 0)
console.log(`[mediapipe] wasm 복사 완료 -> public/mediapipe/wasm (${(total / 1024 / 1024).toFixed(1)} MB)`)
