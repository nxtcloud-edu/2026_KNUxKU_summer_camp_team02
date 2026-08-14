// SpeechRecognition 을 흉내 낸다. 실제 인식기 없이 타이밍만 시험한다
export const fired = { started: 0 }
class MockSR {
  constructor() { this.lang=''; MockSR.last = this }
  start() { fired.started++; this.onstart?.() }
  stop() { this.onend?.() }
  abort() { this.onend?.() }
  /** 인식 결과 하나를 밀어 넣는다 */
  say(text, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: Object.assign([[{ transcript: text }]].map(r=>Object.assign(r,{isFinal})), { length: 1 }) })
  }
}
globalThis.window = globalThis
globalThis.SpeechRecognition = MockSR
globalThis.webkitSpeechRecognition = MockSR
globalThis.MockSR = MockSR
