/**
 * 성능·정확도 확인 페이지 — http://127.0.0.1:5180/#bench
 *
 * 두 가지를 이 화면에서 확정한다.
 *  1) 팀원 각자의 노트북에서 추론이 몇 ms 걸리는지 (추정 말고 실측)
 *  2) 머리 자세 행렬이 행 우선인지 열 우선인지 (문서에 없어서 눈으로 확인해야 한다)
 *
 * 데모 화면이 아니라 개발용 도구다. 제품 UI 규칙을 따르지 않는다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createVisionLoop } from '../lib/vision/visionEngine'
import { STATE_LABEL } from '../lib/vision/attention'
import { RATES, POSE, NOD, USE_EYE_SIGNAL, PHONE, MODELS, DEGRADE } from '../lib/vision/constants'
import { probeGpu, cpuThreadInfo } from '../lib/vision/gpuProbe'
import { Button } from '../components/ui'

const PHONE_DUTY = DEGRADE.phoneDutyLimit

const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))

export default function BenchScreen() {
  const videoRef = useRef(null)
  const loopRef = useRef(null)
  const streamRef = useRef(null)

  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [snap, setSnap] = useState(null)
  const [columnMajor, setColumnMajor] = useState(true)
  const [detectPhone, setDetectPhone] = useState(false)
  const [useEye, setUseEye] = useState(USE_EYE_SIGNAL)
  const [allowCpu, setAllowCpu] = useState(false)
  const [bigModel, setBigModel] = useState(true) // 기본이 Lite2다
  const [phoneMs, setPhoneMs] = useState(RATES.phoneMs)
  // 스터디룸이 강등을 끄고 도니 측정도 같은 조건에서 한다.
  // 여기 기본값이 방과 다르면 여기서 잰 숫자가 방의 숫자가 아니다
  const [autoDegrade, setAutoDegrade] = useState(false)
  const [degradeMsg, setDegradeMsg] = useState('')
  const [env] = useState(() => ({ gpu: probeGpu(), cpu: cpuThreadInfo() }))
  const [delegate, setDelegate] = useState('—')
  const [history, setHistory] = useState([])

  const stop = useCallback(() => {
    loopRef.current?.stop()
    loopRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setRunning(false)
  }, [])

  useEffect(() => () => stop(), [stop])

  const start = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      streamRef.current = stream
      const v = videoRef.current
      v.srcObject = stream
      v.muted = true
      await v.play()

      const loop = createVisionLoop({
        video: v,
        detectPhone,
        phoneModelUrl: bigModel ? MODELS.objectDetectorLite2 : MODELS.objectDetectorLite0,
        phoneMs,
        autoDegrade,
        columnMajor,
        useEye,
        allowCpu,
        onDegrade: (d) =>
          setDegradeMsg(
            d.kind === 'off'
              ? d.reason
              : d.kind === 'phoneSlow'
                ? `폰 추론 p95 ${d.p95.toFixed(0)}ms 가 한도 ${d.limitMs.toFixed(0)}ms(주기의 ${Math.round(
                    PHONE_DUTY * 100,
                  )}%)를 넘어 주기를 ${d.intervalMs}ms로 늘렸습니다`
                : `얼굴 추론이 느려 주기를 ${d.intervalMs}ms로 늘렸습니다 (p95 ${d.p95.toFixed(0)}ms)`,
          ),
        onSample: (s) => {
          setSnap(s)
          setHistory((h) => {
            // 그래프는 끄덕임을 본다 — 졸음 판정이 실제로 쓰는 값이다
            const next = [...h, { t: Date.now(), pitch: s.pose?.nod ?? null }]
            return next.length > 150 ? next.slice(-150) : next
          })
        },
      })
      loopRef.current = loop
      const info = await loop.start()
      setDelegate(info?.faceDelegate || '—')
      setRunning(true)
    } catch (e) {
      setError(`${e.name || 'Error'}: ${e.message || e}`)
      stop()
    }
  }

  const toggleMajor = () => {
    const next = !columnMajor
    setColumnMajor(next)
    loopRef.current?.setColumnMajor(next)
  }

  const pose = snap?.pose
  const faceMs = snap?.perf?.faceMs
  const phoneInferMs = snap?.perf?.phoneMs

  // 표본 주기 대비 얼마나 먹는지 = 실질 부담률
  const faceDuty = faceMs != null ? (faceMs / RATES.faceMs) * 100 : null
  const phoneDuty =
    phoneInferMs != null ? (phoneInferMs / (snap?.diag?.phoneIntervalMs || phoneMs)) * 100 : null
  const totalDuty = (faceDuty || 0) + (phoneDuty || 0)

  return (
    <main className="min-h-full bg-warm p-8" style={{ minWidth: 1280 }}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="t-screen">시각 신호 측정</h1>
          <p className="t-help mt-1">
            팀원 각자의 노트북에서 돌려 보고 실제 수치를 모으는 개발용 페이지입니다. 제품 화면이 아닙니다.
          </p>
        </div>
        <div className="flex gap-2">
          {!running ? (
            <Button variant="primary" onClick={start}>
              측정 시작
            </Button>
          ) : (
            <Button variant="danger" onClick={stop}>
              중지
            </Button>
          )}
          <Button variant="secondary" onClick={() => (window.location.hash = '')}>
            앱으로
          </Button>
        </div>
      </header>

      {degradeMsg && <div className="mb-6 rounded-md bg-peach p-4 t-body">자동 강등 — {degradeMsg}</div>}

      {error && (
        <div className="mb-6 rounded-md bg-danger-bg p-4 t-body text-danger">
          카메라를 열지 못했습니다 — {error}
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-4">
        <label className="inline-flex items-center gap-2 t-body">
          <input
            type="checkbox"
            checked={detectPhone}
            onChange={(e) => setDetectPhone(e.target.checked)}
            disabled={running}
          />
          폰 감지도 함께
        </label>
        <label className="inline-flex items-center gap-2 t-body">
          <input
            type="checkbox"
            checked={bigModel}
            onChange={(e) => setBigModel(e.target.checked)}
            disabled={running || !detectPhone}
          />
          큰 폰 모델 Lite2 (448px · 기본값) — 끄면 Lite0(320px)
        </label>
        <label className="inline-flex items-center gap-2 t-body">
          폰 주기
          <input
            type="range"
            min={250}
            max={5000}
            step={250}
            value={phoneMs}
            onChange={(e) => setPhoneMs(Number(e.target.value))}
            disabled={running}
          />
          <span className="tnum t-item">{phoneMs}ms</span>
          <span className="t-caption">확정까지 {((phoneMs * PHONE.confirmCount) / 1000).toFixed(1)}초</span>
        </label>
        <label className="inline-flex items-center gap-2 t-body">
          <input
            type="checkbox"
            checked={useEye}
            onChange={(e) => setUseEye(e.target.checked)}
            disabled={running}
          />
          눈 감김 신호 켜기 (blendshape 출력 — 부담 증가)
        </label>
        <label className="inline-flex items-center gap-2 t-body">
          <input
            type="checkbox"
            checked={autoDegrade}
            onChange={(e) => setAutoDegrade(e.target.checked)}
            disabled={running}
          />
          자동 강등 켜기 (측정 중엔 꺼두세요)
        </label>
        <label className="inline-flex items-center gap-2 t-body">
          <input type="checkbox" checked={columnMajor} onChange={toggleMajor} />
          행렬을 열 우선으로 해석
        </label>
        <label className="inline-flex items-center gap-2 t-body">
          <input
            type="checkbox"
            checked={allowCpu}
            onChange={(e) => setAllowCpu(e.target.checked)}
            disabled={running}
          />
          GPU 실패 시 CPU로라도 시도 (기본 꺼짐 — 꼬리 지연이 큽니다)
        </label>
      </div>

      <div className="grid grid-cols-[520px_1fr] gap-6">
        <div>
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full rounded-md bg-surface-dark"
            style={{ transform: 'scaleX(-1)' }}
          />
          <PitchChart history={history} />
        </div>

        <div className="space-y-4">
          <Card title="성능">
            <Metric
              label="얼굴 추론 (중앙값)"
              value={`${fmt(faceMs)} ms`}
              note={`주기 ${RATES.faceMs}ms = ${(1000 / RATES.faceMs).toFixed(0)}fps`}
            />
            <Metric
              label="폰 추론 (중앙값)"
              value={phoneInferMs != null ? `${fmt(phoneInferMs)} ms` : '—'}
              note={`주기 ${snap?.diag?.phoneIntervalMs ?? phoneMs}ms · 확정 ${(
                ((snap?.diag?.phoneIntervalMs ?? phoneMs) * PHONE.confirmCount) /
                1000
              ).toFixed(1)}초`}
            />
            <Metric
              label="델리게이트"
              value={delegate}
              note={delegate === 'CPU' ? '꼬리 지연이 큽니다' : 'GPU 가속 사용 중'}
              warn={delegate === 'CPU'}
            />
            <Metric
              label="현재 주기"
              value={`${snap?.diag?.intervalMs ?? RATES.faceMs} ms`}
              note={`${(1000 / (snap?.diag?.intervalMs || RATES.faceMs)).toFixed(1)}fps`}
            />
            <Metric
              label="p95"
              value={snap?.diag?.p95 != null ? `${snap.diag.p95.toFixed(1)} ms` : '측정 중'}
              note="이게 실제 체감을 좌우합니다"
              warn={(snap?.diag?.p95 ?? 0) > 25}
            />
            <Metric
              label="실질 부담률"
              value={`${fmt(totalDuty)} %`}
              note="코어 1개 기준. 30%를 넘으면 주기를 늘리세요"
              warn={totalDuty > 30}
            />
          </Card>

          <Card title="이 기기">
            <Metric
              label="GPU 가속"
              value={env.gpu.usable ? '사용 가능' : '불가'}
              note={env.gpu.usable ? '' : env.gpu.reason}
              warn={!env.gpu.usable}
            />
            <Metric label="렌더러" value="" note={env.gpu.renderer || '알 수 없음'} />
            <Metric
              label="CPU 코어"
              value={`${env.cpu.cores ?? '?'} 개`}
              note={`추론에 쓰이는 건 ${env.cpu.usableThreads}개 — wasm 스레드 빌드가 없습니다`}
            />
            <Metric
              label="SharedArrayBuffer"
              value={env.cpu.sharedArrayBuffer ? '있음' : '없음'}
              note="없으면 wasm 멀티스레딩 자체가 불가능합니다"
            />
          </Card>

          <Card title="판정">
            <Metric label="상태" value={snap ? STATE_LABEL[snap.state] : '—'} />
            <Metric label="화면 응시" value={snap?.lookingAtScreen ? '예' : '아니오'} />
            <Metric
              label="끄덕임 (최근 20초)"
              value={`${snap?.nodCount ?? 0} 회`}
              note={`${NOD.countThreshold}회 이상이면 졸음`}
              warn={snap?.drowsy}
            />
            <Metric label="졸음 판정" value={snap?.drowsy ? '졸음' : '정상'} warn={snap?.drowsy} />
            {useEye && <Metric label="긴 눈 감김" value={`${snap?.longClosures ?? 0} 회`} />}
            {detectPhone && (
              <>
                <Metric
                  label="폰(추정)"
                  value={snap?.phoneVisible ? '보임' : '없음'}
                  note={
                    snap?.phoneName ? `'${snap.phoneName}' ${fmt(snap.phoneScore, 3)}` : '후보 클래스 미검출'
                  }
                  warn={snap?.phoneVisible}
                />
                <div className="t-caption">
                  후보: {PHONE.candidates.map((c) => `${c.name}≥${c.minScore}`).join(' · ')}
                </div>
                <div className="mt-2 rounded-sm bg-[var(--hover-bg)] p-3">
                  <div className="t-caption mb-1">모델이 실제로 본 것 (점수순)</div>
                  {snap?.detections?.length ? (
                    <ul className="space-y-0.5">
                      {snap.detections.map((d, i) => (
                        <li key={i} className="flex justify-between t-caption tnum">
                          <span className={d.name === 'cell phone' ? 'font-semibold text-ink' : ''}>
                            {d.name}
                          </span>
                          <span>{d.score.toFixed(3)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="t-caption">아직 아무것도 검출되지 않았습니다</div>
                  )}
                </div>
              </>
            )}
          </Card>

          <Card title="진단">
            <Metric label="추론 표본" value={`${snap?.diag?.samples ?? 0} 회`} />
            <Metric
              label="얼굴 잡힌 횟수"
              value={`${snap?.diag?.faceSeen ?? 0} 회`}
              note={
                snap?.diag?.samples
                  ? `${Math.round(((snap.diag.faceSeen || 0) / snap.diag.samples) * 100)}%`
                  : ''
              }
              warn={!!snap?.diag?.samples && !snap?.diag?.faceSeen}
            />
            <Metric
              label="건너뜀"
              value={`${snap?.diag?.skipped ?? 0} 회`}
              note={snap?.diag?.lastSkipReason || ''}
              warn={(snap?.diag?.skipped ?? 0) > 5}
            />
            <Metric
              label="오류"
              value={`${snap?.diag?.errors ?? 0} 회`}
              warn={(snap?.diag?.errors ?? 0) > 0}
            />
            {snap?.diag?.lastError && (
              <p className="t-caption mt-2 rounded-sm bg-danger-bg p-2 text-danger">{snap.diag.lastError}</p>
            )}
          </Card>

          <Card title="머리 자세">
            {/* 이름이 실제 동작을 가리킨다. 예전에는 수학 관례 이름(yaw/pitch/roll)을
                그대로 붙였는데, 그 이름들이 실제 동작과 한 칸씩 어긋나 있었다 */}
            <Metric label="좌우 돌림 (도리도리)" value={`${fmt(pose?.turn)}°`} note={`허용 ±${POSE.turnLimit}°`} />
            <Metric label="위아래 끄덕임" value={`${fmt(pose?.nod)}°`} note={`허용 ±${POSE.nodLimit}°`} />
            <Metric label="갸웃 (기울기)" value={`${fmt(pose?.tilt)}°`} />
            <p className="t-help mt-3 rounded-sm bg-peach p-3">
              <strong>10초 확인</strong> — 고개를 <strong>좌우로</strong> 흔들면 &ldquo;좌우 돌림&rdquo;만,{' '}
              <strong>끄덕이면</strong> &ldquo;위아래 끄덕임&rdquo;만 움직여야 맞습니다. 다른 칸이 움직이면 축이
              어긋난 것입니다 (예전에 그랬고, 그래서 옆을 세 번 보면 졸음으로 판정됐습니다).
              부호가 반대라면 위의 &ldquo;열 우선&rdquo; 체크를 꺼 보세요 — 그 체크는 부호만 뒤집습니다.
            </p>
          </Card>
        </div>
      </div>
    </main>
  )
}

function Card({ title, children }) {
  return (
    <section className="rounded-md border border-hairline bg-surface p-5">
      <h2 className="t-section mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Metric({ label, value, note, warn }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="t-body text-subtle">{label}</span>
      <span className="text-right">
        <span className={`t-item tnum ${warn ? 'text-danger font-semibold' : ''}`}>{value}</span>
        {note && <span className="t-caption ml-2">{note}</span>}
      </span>
    </div>
  )
}

/** pitch 시계열 — 끄덕임이 눈에 보이는지 확인용 */
function PitchChart({ history }) {
  const pts = history.filter((h) => h.pitch != null)
  if (pts.length < 2) {
    return <div className="mt-3 h-[120px] rounded-md border border-hairline bg-surface" />
  }
  const W = 520
  const H = 120
  const vals = pts.map((p) => p.pitch)
  const min = Math.min(-30, ...vals)
  const max = Math.max(30, ...vals)
  const x = (i) => (i / (pts.length - 1)) * W
  const y = (v) => H - ((v - min) / (max - min)) * H
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.pitch).toFixed(1)}`).join(' ')

  return (
    <div className="mt-3 rounded-md border border-hairline bg-surface p-2">
      <div className="t-caption mb-1 px-1">pitch 시계열 — 졸면 위아래로 오르내립니다</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-label="pitch 시계열">
        <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="var(--border-hairline)" strokeWidth="1" />
        <path d={d} fill="none" stroke="var(--chart-focus)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
