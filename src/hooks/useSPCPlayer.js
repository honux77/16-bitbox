import { useState, useEffect, useRef, useCallback } from 'react'

// SPC engine singleton - loaded lazily inside a hidden iframe for full isolation
// from VGM's Emscripten globals (Module, FS, HEAP16, ccall, ccallFunc, etc.)
let spcEngine = null
let spcEnginePromise = null

function loadSPCEngine() {
  if (spcEngine) return Promise.resolve(spcEngine)
  if (spcEnginePromise) return spcEnginePromise

  spcEnginePromise = new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.srcdoc = [
      '<!DOCTYPE html><html><head>',
      '<script>var Module = { memoryInitializerPrefixURL: "/spc-engine/" };<\/script>',
      '<script src="/spc-engine/spc_snes.js"><\/script>',
      '</head><body></body></html>'
    ].join('')

    document.body.appendChild(iframe)

    const check = setInterval(() => {
      try {
        const win = iframe.contentWindow
        if (win &&
            typeof win._my_init === 'function' &&
            typeof win._my_decode === 'function' &&
            win.HEAP16 &&
            win.Module && win.Module.calledRun) {
          clearInterval(check)

          spcEngine = {
            win,  // iframe's window - use for HEAP16 (may change on memory growth)
            allocate: win.allocate,
            ALLOC_STACK: win.ALLOC_STACK,
            _my_init: win._my_init,
            _my_decode: win._my_decode,
            _iframe: iframe,
          }

          resolve(spcEngine)
        }
      } catch (e) {
        // keep polling
      }
    }, 100)

    setTimeout(() => {
      clearInterval(check)
      if (!spcEngine) {
        try { document.body.removeChild(iframe) } catch (e) { }
        spcEnginePromise = null
        reject(new Error('SPC engine init timeout'))
      }
    }, 15000)
  })

  return spcEnginePromise
}

export function useSPCPlayer() {
  // isReady=true always; actual engine loads lazily in loadZip
  const [isReady] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [trackList, setTrackList] = useState([])
  const [trackInfo, setTrackInfo] = useState(null)
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [frequencyData, setFrequencyData] = useState(new Array(16).fill(0))
  const [elapsed, setElapsed] = useState(0)

  const uiStartRef = useRef(null)
  const contextRef = useRef(null)
  const nodeRef = useRef(null)
  const analyserRef = useRef(null)
  const gainNodeRef = useRef(null)
  const nextTrackRef = useRef(null)
  const wakeLockRef = useRef(null)
  const spcDataRef = useRef([])
  const fadeTimerRef = useRef(null)
  const endTimerRef = useRef(null)
  const isPlayingRef = useRef(false)

  // UI elapsed timer
  useEffect(() => {
    if (isPlaying && currentTrack) {
      uiStartRef.current = Date.now()
      const dur = currentTrack?.length || 0
      const id = setInterval(() => {
        const t = ((Date.now() - uiStartRef.current) / 1000) | 0
        setElapsed(Math.min(dur, t))
      }, 250)
      return () => clearInterval(id)
    } else {
      setElapsed(0)
      uiStartRef.current = null
    }
  }, [isPlaying, currentTrack])

  const parseSPCID666 = useCallback((buffer) => {
    try {
      const readString = (offset, len) => {
        const bytes = buffer.slice(offset, offset + len)
        let end = bytes.indexOf(0)
        if (end < 0) end = len
        return new TextDecoder('ascii').decode(bytes.slice(0, end)).trim()
      }
      const title = readString(0x2E, 32)
      const game = readString(0x4E, 32)
      const artist = readString(0xB1, 32)
      const duration = parseInt(readString(0xA9, 3), 10) || 0
      const fade = parseInt(readString(0xAC, 5), 10) || 0
      return { title, game, artist, duration, fade }
    } catch (e) {
      return null
    }
  }, [])

  const loadZip = useCallback(async (url, onProgress) => {
    // Clear previous state
    setTrackList([])
    setCurrentTrackIndex(0)
    setCurrentTrack(null)
    setTrackInfo(null)
    spcDataRef.current = []

    try {
      // Lazy-load SPC engine on first use (won't reload if already loaded)
      onProgress?.({ percent: 0, message: 'INITIALIZING ENGINE...' })
      await loadSPCEngine()

      // Ensure minizip is available
      onProgress?.({ percent: 15, message: 'LOADING MINIZIP...' })
      if (!window.Minizip) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script')
          s.src = '/minizip-asm.min.js'
          s.onload = resolve
          s.onerror = reject
          document.head.appendChild(s)
        })
      }

      onProgress?.({ percent: 25, message: 'DOWNLOADING...' })
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      const byteArray = new Uint8Array(arrayBuffer)

      onProgress?.({ percent: 50, message: 'EXTRACTING TRACKS...' })
      const mz = new window.Minizip(byteArray)
      const fileList = mz.list()
      const spcFiles = fileList.filter(f => f.filepath.toLowerCase().endsWith('.spc'))
      const total = spcFiles.length
      const tracks = []

      for (let i = 0; i < spcFiles.length; i++) {
        const file = spcFiles[i]
        onProgress?.({ percent: 50 + Math.round((i / total) * 45), message: `LOADING TRACK ${i + 1}/${total}...` })

        const fileArray = mz.extract(file.filepath)
        const spcInfo = parseSPCID666(fileArray)
        const duration = spcInfo?.duration || 180
        const fade = spcInfo?.fade || 10000
        const lengthSeconds = duration + Math.ceil(fade / 1000)

        const track = {
          path: file.filepath,
          name: spcInfo?.title || file.filepath.replace(/\.spc$/i, '').replace(/^\d+\s*/, ''),
          length: lengthSeconds,
          lengthFormatted: `${Math.floor(lengthSeconds / 60)}:${(lengthSeconds % 60).toString().padStart(2, '0')}`,
          duration,
          fade,
          title: `${spcInfo?.title || ''}|||${spcInfo?.game || ''}|||${spcInfo?.artist || ''}`
        }
        tracks.push(track)
        spcDataRef.current.push({ filename: file.filepath, data: new Uint8Array(fileArray), ...track })
      }

      onProgress?.({ percent: 100, message: 'DONE' })
      setTrackList(tracks)
      if (tracks.length > 0) setCurrentTrackIndex(0)
      return tracks
    } catch (e) {
      console.error('Failed to load SPC zip:', e)
      return []
    }
  }, [parseSPCID666])

  const stop = useCallback(() => {
    if (fadeTimerRef.current) { clearInterval(fadeTimerRef.current); fadeTimerRef.current = null }
    if (endTimerRef.current) { clearTimeout(endTimerRef.current); endTimerRef.current = null }
    if (nodeRef.current) {
      try { nodeRef.current.onaudioprocess = null; nodeRef.current.disconnect() } catch (e) { }
    }
    if (gainNodeRef.current) try { gainNodeRef.current.disconnect() } catch (e) { }
    if (analyserRef.current) try { analyserRef.current.disconnect() } catch (e) { }
    if (contextRef.current && contextRef.current.state === 'running') {
      try { contextRef.current.suspend() } catch (e) { }
    }
    isPlayingRef.current = false
    setElapsed(0)
    setIsPlaying(false)
    setCurrentTrack(null)
    setTrackInfo(null)
  }, [])

  const play = useCallback((trackIndex, tracks = null) => {
    const list = tracks || trackList
    if (list.length === 0) return

    const idx = trackIndex !== undefined ? trackIndex : currentTrackIndex
    const track = list[idx]
    if (!track) return

    const spcEntry = spcDataRef.current[idx]
    if (!spcEntry) return

    const engine = spcEngine
    if (!engine) return

    // Clean up previous playback without suspending AudioContext.
    // Calling stop() would suspend the context, causing a race condition
    // with the subsequent resume() and breaking playback on mobile.
    if (fadeTimerRef.current) { clearInterval(fadeTimerRef.current); fadeTimerRef.current = null }
    if (endTimerRef.current) { clearTimeout(endTimerRef.current); endTimerRef.current = null }
    if (nodeRef.current) {
      try { nodeRef.current.onaudioprocess = null; nodeRef.current.disconnect() } catch (e) { }
    }
    if (gainNodeRef.current) try { gainNodeRef.current.disconnect() } catch (e) { }
    if (analyserRef.current) try { analyserRef.current.disconnect() } catch (e) { }
    isPlayingRef.current = false

    // AudioContext
    if (!contextRef.current || contextRef.current.state === 'closed') {
      window.AudioContext = window.AudioContext || window.webkitAudioContext
      contextRef.current = new AudioContext()
    }
    if (contextRef.current.state === 'suspended') {
      contextRef.current.resume().catch(() => {})
    }

    // Fresh audio nodes
    if (nodeRef.current) try { nodeRef.current.disconnect() } catch (e) { }
    if (gainNodeRef.current) try { gainNodeRef.current.disconnect() } catch (e) { }
    if (analyserRef.current) try { analyserRef.current.disconnect() } catch (e) { }

    const frameSize = 16384
    nodeRef.current = contextRef.current.createScriptProcessor(frameSize, 0, 2)

    const gainNode = contextRef.current.createGain()
    gainNode.gain.value = 1.0
    gainNodeRef.current = gainNode

    const analyser = contextRef.current.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    analyserRef.current = analyser

    // Load SPC into WASM memory
    const spcPtr = engine.allocate(spcEntry.data, 'i8', engine.ALLOC_STACK)
    engine._my_init(spcPtr, spcEntry.data.length)

    // Resampling: SPC outputs 32kHz
    const inRate = 32000
    const outRate = contextRef.current.sampleRate
    const ratio = inRate / outRate
    const lastSample = 1 + Math.floor(frameSize * ratio)

    // Decode buffer in WASM heap
    const bufSize = 4 * (lastSample - 1)
    const buf = engine.allocate(new Uint8Array(bufSize + 4), 'i8', engine.ALLOC_STACK)

    const getHEAP16 = () => engine.win.HEAP16

    const sampleAt = (chan, x) => {
      const heap16 = getHEAP16()
      const offset = ratio * x
      const bufferOffset = Math.floor(offset)
      const high = offset - bufferOffset
      const low = 1 - high
      const base = chan + buf / 2 + bufferOffset * 2
      return heap16[base] * low + heap16[base + 1] * high
    }

    nodeRef.current.onaudioprocess = (e) => {
      if (!isPlayingRef.current) return
      engine._my_decode(buf, lastSample * 2)
      const output = e.outputBuffer
      for (let chan = 0; chan < output.numberOfChannels; chan++) {
        const outData = output.getChannelData(chan)
        for (let k = 0; k < outData.length; k++) {
          outData[k] = sampleAt(chan, k) / 32000
        }
      }
    }

    // Connect: ScriptProcessor -> GainNode -> Analyser -> Destination
    nodeRef.current.connect(gainNode)
    gainNode.connect(analyser)
    analyser.connect(contextRef.current.destination)

    // Track info
    const titleParts = (track.title || '').split('|||')
    setTrackInfo({
      title: titleParts[0] || track.name,
      game: titleParts[1] || '',
      system: 'Super Nintendo',
      author: titleParts[2] || '',
      length: track.lengthFormatted
    })

    setCurrentTrack(track)
    setCurrentTrackIndex(idx)
    isPlayingRef.current = true
    setIsPlaying(true)

    // Duration-based ending with fade
    const dur = track.duration || 180
    const fadeDur = track.fade || 10000
    const fadeStartMs = dur * 1000

    if (fadeDur > 0) {
      fadeTimerRef.current = setTimeout(() => {
        if (!isPlayingRef.current || !gainNodeRef.current) return
        const steps = 20
        const interval = fadeDur / steps
        let step = 0
        fadeTimerRef.current = setInterval(() => {
          step++
          if (gainNodeRef.current) gainNodeRef.current.gain.value = Math.max(0, 1 - step / steps)
          if (step >= steps) { clearInterval(fadeTimerRef.current); fadeTimerRef.current = null }
        }, interval)
      }, fadeStartMs)
    }

    endTimerRef.current = setTimeout(() => {
      if (isPlayingRef.current && nextTrackRef.current) nextTrackRef.current()
    }, fadeStartMs + fadeDur + 500)
  }, [trackList, currentTrackIndex, stop])

  const pause = useCallback(() => {
    if (nodeRef.current) try { nodeRef.current.disconnect() } catch (e) { }
    isPlayingRef.current = false
    setIsPlaying(false)
  }, [])

  const togglePlayback = useCallback(() => {
    if (isPlaying) pause()
    else if (currentTrack) play(currentTrackIndex)
    else play(0)
  }, [isPlaying, currentTrack, currentTrackIndex, pause, play])

  const nextTrack = useCallback(() => {
    nextTrackRef.current = nextTrack
    const nextIdx = (currentTrackIndex + 1) % trackList.length
    play(nextIdx)
  }, [currentTrackIndex, trackList.length, play])

  const prevTrack = useCallback(() => {
    const prevIdx = currentTrackIndex === 0 ? trackList.length - 1 : currentTrackIndex - 1
    play(prevIdx)
  }, [currentTrackIndex, trackList.length, play])

  // Unlock AudioContext synchronously in a user-gesture callback
  // so that subsequent async play() calls are not blocked on mobile.
  const resumeAudio = useCallback(() => {
    if (!contextRef.current || contextRef.current.state === 'closed') {
      window.AudioContext = window.AudioContext || window.webkitAudioContext
      contextRef.current = new AudioContext()
    }
    if (contextRef.current.state === 'suspended') {
      contextRef.current.resume()
    }
  }, [])

  useEffect(() => { nextTrackRef.current = nextTrack }, [nextTrack])

  // Screen Wake Lock
  useEffect(() => {
    const requestWakeLock = async () => {
      if (!('wakeLock' in navigator)) return
      if (!isPlaying || document.visibilityState !== 'visible' || wakeLockRef.current) return
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null })
      } catch (err) { }
    }
    const releaseWakeLock = async () => {
      if (wakeLockRef.current) try { await wakeLockRef.current.release(); wakeLockRef.current = null } catch (e) { }
    }
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'hidden') {
        if (nodeRef.current) try { nodeRef.current.disconnect() } catch (e) { }
        isPlayingRef.current = false
        setIsPlaying(false)
      } else if (document.visibilityState === 'visible') {
        await requestWakeLock()
        if (contextRef.current && contextRef.current.state === 'suspended') {
          try { await contextRef.current.resume() } catch (e) { }
        }
      }
    }
    if (isPlaying) {
      requestWakeLock()
      document.addEventListener('visibilitychange', handleVisibilityChange)
    } else {
      releaseWakeLock()
    }
    return () => { document.removeEventListener('visibilitychange', handleVisibilityChange); releaseWakeLock() }
  }, [isPlaying])

  // Frequency data loop
  useEffect(() => {
    if (!analyserRef.current || !isPlaying) return
    let rafId = null
    const freqUint8 = new Uint8Array(analyserRef.current.frequencyBinCount)
    const tick = () => {
      try {
        analyserRef.current.getByteFrequencyData(freqUint8)
        const bins = 16
        const binSize = Math.max(1, Math.floor(freqUint8.length / bins))
        const next = []
        for (let i = 0; i < bins; i++) {
          let sum = 0
          for (let j = 0; j < binSize; j++) { const idx = i * binSize + j; if (idx < freqUint8.length) sum += freqUint8[idx] }
          next[i] = Math.round(sum / binSize)
        }
        setFrequencyData(next)
      } catch (_) { }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => { if (rafId) cancelAnimationFrame(rafId) }
  }, [isPlaying])

  // Media Session API
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    try {
      if (trackInfo) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: trackInfo.title,
          artist: trackInfo.author || 'Unknown Artist',
          album: trackInfo.game || '16-bitbox SPC Archive',
          artwork: [
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }
          ]
        })
      }
      navigator.mediaSession.setActionHandler('play', () => togglePlayback())
      navigator.mediaSession.setActionHandler('pause', () => togglePlayback())
      navigator.mediaSession.setActionHandler('stop', () => stop())
      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack())
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack())
    } catch (e) { }
    return () => {
      try {
        if ('mediaSession' in navigator) {
          ;['play', 'pause', 'stop', 'previoustrack', 'nexttrack'].forEach(a =>
            navigator.mediaSession.setActionHandler(a, null))
        }
      } catch (e) { }
    }
  }, [trackInfo, togglePlayback, stop, nextTrack, prevTrack])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused' } catch (e) { }
  }, [isPlaying])

  return {
    isReady,
    isPlaying,
    currentTrack,
    currentTrackIndex,
    trackList,
    trackInfo,
    frequencyData,
    elapsed,
    loadZip,
    play,
    pause,
    stop,
    togglePlayback,
    nextTrack,
    prevTrack,
    resumeAudio
  }
}
