import { useState, useEffect, useRef, useCallback } from 'react'

export function useVGMPlayer() {
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [trackList, setTrackList] = useState([])
  const [trackInfo, setTrackInfo] = useState(null)
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [frequencyData, setFrequencyData] = useState(new Array(16).fill(0))
  const [elapsed, setElapsed] = useState(0)
  const uiStartRef = useRef(null)
  const nextTrackGuardRef = useRef(0)

  const contextRef = useRef(null)
  const workletNodeRef = useRef(null)
  const analyserRef = useRef(null)
  const functionsRef = useRef(null)
  const dataPtrsRef = useRef([])
  const isPlayingRef = useRef(false)
  const isGeneratingRef = useRef(false)
  const sampleRateRef = useRef(44100)
  const nextTrackRef = useRef(null)
  const wakeLockRef = useRef(null)
  const vgmFSRef = useRef(null)
  const pumpBuffersRef = useRef(null)

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

  const pumpBuffers = useCallback(() => {
    if (!isPlayingRef.current || !workletNodeRef.current || !functionsRef.current) return

    if (functionsRef.current.VGMEnded()) {
      // Auto-advance with guard to prevent double-trigger
      const now = Date.now()
      if (now - nextTrackGuardRef.current > 800) {
        nextTrackGuardRef.current = now
        setTimeout(() => {
          if (nextTrackRef.current) nextTrackRef.current()
        }, 500)
      }
      return
    }

    const N = 4096
    for (let i = 0; i < 4; i++) {
      functionsRef.current.FillBuffer(dataPtrsRef.current[0], dataPtrsRef.current[1], N)
      const leftHeap = new Float32Array(window.Module.HEAPU8.buffer, dataPtrsRef.current[0], N)
      const rightHeap = new Float32Array(window.Module.HEAPU8.buffer, dataPtrsRef.current[1], N)
      const left = new Float32Array(leftHeap)
      const right = new Float32Array(rightHeap)
      workletNodeRef.current.port.postMessage(
        { type: 'buffer', left, right },
        [left.buffer, right.buffer]
      )
    }
  }, [])

  // Keep pumpBuffers ref up to date
  useEffect(() => {
    pumpBuffersRef.current = pumpBuffers
  }, [pumpBuffers])

  const initPlayer = useCallback(async () => {
    try {
      window.AudioContext = window.AudioContext || window.webkitAudioContext
      contextRef.current = new AudioContext()
      sampleRateRef.current = contextRef.current.sampleRate

      // Load AudioWorklet processor (modern replacement for ScriptProcessorNode)
      await contextRef.current.audioWorklet.addModule('/vgmplay-audio-processor.js')

      const Module = window.Module
      functionsRef.current = {
        FillBuffer: Module.cwrap('FillBuffer2', 'void', ['number', 'number', 'number']),
        OpenVGMFile: Module.cwrap('OpenVGMFile', 'number', ['string']),
        CloseVGMFile: Module.cwrap('CloseVGMFile'),
        PlayVGM: Module.cwrap('PlayVGM'),
        StopVGM: Module.cwrap('StopVGM'),
        VGMEnded: Module.cwrap('VGMEnded'),
        GetTrackLength: Module.cwrap('GetTrackLength'),
        GetTrackLengthDirect: Module.cwrap('GetTrackLengthDirect', 'number', ['string']),
        SetSampleRate: Module.cwrap('SetSampleRate', 'number', ['number']),
        SetLoopCount: Module.cwrap('SetLoopCount', 'number', ['number']),
        Seek: Module.cwrap('Seek', null, ['number']),
        ShowTitle: Module.cwrap('ShowTitle', 'string'),
      }

      // Allocate WASM heap buffers for Float32 audio (N=4096, Float32=4 bytes)
      dataPtrsRef.current[0] = Module._malloc(4096 * 4 * 2)
      dataPtrsRef.current[1] = Module._malloc(4096 * 4 * 2)

      // Save VGM's FS reference before SPC engine can overwrite window.FS
      vgmFSRef.current = window.FS

      functionsRef.current.SetSampleRate(sampleRateRef.current)

      // Suppress noisy debug logs from vgmplay WASM
      try {
        const origLog = console.log
        console.log = (...args) => {
          const text = args.map(a => typeof a === 'string' ? a : String(a)).join(' ')
          if (text.length > 40 && /[^\x20-\x7E]+/.test(text)) return
          origLog.apply(console, args)
        }
      } catch (e) { }

      setIsReady(true)
    } catch (e) {
      console.error('Failed to init VGM player:', e)
    }
  }, [])

  const loadZip = useCallback(async (url, onProgress) => {
    if (!isReady) return

    setTrackList([])
    setCurrentTrackIndex(0)
    setCurrentTrack(null)
    setTrackInfo(null)

    // Clean up previous VGM files from FS
    const vgmFS = vgmFSRef.current || window.FS
    try {
      const files = vgmFS.readdir('/')
      for (const file of files) {
        if (file.endsWith('.vgm') || file.endsWith('.vgz')) {
          try { vgmFS.unlink('/' + file) } catch (e) { }
        }
      }
    } catch (e) { }

    try {
      onProgress?.({ percent: 10, message: 'DOWNLOADING...' })
      const response = await fetch(url)
      const arrayBuffer = await response.arrayBuffer()
      const byteArray = new Uint8Array(arrayBuffer)

      onProgress?.({ percent: 40, message: 'EXTRACTING TRACKS...' })
      const mz = new window.Minizip(byteArray)
      const fileList = mz.list()
      const vgmFiles = fileList.filter(f => {
        const lp = f.filepath.toLowerCase()
        return lp.endsWith('.vgm') || lp.endsWith('.vgz')
      })
      const total = vgmFiles.length
      const tracks = []

      for (let i = 0; i < vgmFiles.length; i++) {
        const file = vgmFiles[i]
        const originalPath = file.filepath
        onProgress?.({ percent: 40 + Math.round((i / total) * 55), message: `LOADING TRACK ${i + 1}/${total}...` })

        try {
          const fileArray = mz.extract(originalPath)
          const safePath = originalPath.replace(/[^a-zA-Z0-9._-]/g, '_')

          try { vgmFS.unlink(safePath) } catch (e) { }
          vgmFS.createDataFile('/', safePath, fileArray, true, true)

          // Use GetTrackLengthDirect to avoid open/play/stop cycle
          const length = functionsRef.current.GetTrackLengthDirect(safePath) * sampleRateRef.current / 44100
          const lengthSeconds = Math.round(length / sampleRateRef.current)

          // Read title by briefly opening the file
          functionsRef.current.OpenVGMFile(safePath)
          const title = functionsRef.current.ShowTitle()
          functionsRef.current.CloseVGMFile()

          const titleParts = title.split('|||')
          // ShowTitle format: "TITLE|||name|||GAME|||game|||SYSTEM|||system|||ARTIST|||author"
          // Use odd indices (values), even indices are labels ("TITLE", "GAME", etc.)
          const trackName = titleParts[1] || originalPath.replace(/\.(vgm|vgz)$/i, '').replace(/^\d+\s*/, '')

          tracks.push({
            path: safePath,
            name: trackName,
            length: lengthSeconds,
            lengthFormatted: new Date(lengthSeconds * 1000).toISOString().substr(14, 5),
            title
          })
        } catch (extractError) {
          console.warn(`Failed to extract file: ${originalPath}`, extractError)
        }
      }

      onProgress?.({ percent: 100, message: 'DONE' })
      setTrackList(tracks)
      if (tracks.length > 0) setCurrentTrackIndex(0)
      return tracks
    } catch (e) {
      console.error('Failed to load zip:', e)
      return []
    }
  }, [isReady])

  const stop = useCallback(() => {
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.postMessage({ type: 'stop' })
        workletNodeRef.current.disconnect()
      } catch (e) { }
      workletNodeRef.current = null
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect() } catch (e) { }
    }
    if (contextRef.current && contextRef.current.state === 'running') {
      try { contextRef.current.suspend() } catch (e) { }
    }
    if (functionsRef.current) {
      functionsRef.current.StopVGM()
      functionsRef.current.CloseVGMFile()
    }
    isPlayingRef.current = false
    isGeneratingRef.current = false
    setElapsed(0)
    setIsPlaying(false)
    setCurrentTrack(null)
    setTrackInfo(null)
  }, [])

  const play = useCallback((trackIndex, tracks = null) => {
    const list = tracks || trackList
    if (!isReady || list.length === 0) return

    const idx = trackIndex !== undefined ? trackIndex : currentTrackIndex
    const track = list[idx]
    if (!track) return

    // Stop current playback
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.postMessage({ type: 'stop' })
        workletNodeRef.current.disconnect()
      } catch (e) { }
      workletNodeRef.current = null
    }
    if (functionsRef.current) {
      functionsRef.current.StopVGM()
      functionsRef.current.CloseVGMFile()
    }

    // Ensure AudioContext is running
    if (!contextRef.current || contextRef.current.state === 'closed') {
      window.AudioContext = window.AudioContext || window.webkitAudioContext
      contextRef.current = new AudioContext()
      // Re-add worklet module if context was recreated
      contextRef.current.audioWorklet.addModule('/vgmplay-audio-processor.js').catch(e =>
        console.error('Failed to reload audio worklet:', e)
      )
    }
    if (contextRef.current.state === 'suspended') {
      contextRef.current.resume().catch(e => console.error('Audio resume failed:', e))
    }

    // Create fresh AudioWorkletNode and Analyser
    const workletNode = new AudioWorkletNode(contextRef.current, 'vgmplay-processor', {
      outputChannelCount: [2]
    })
    workletNodeRef.current = workletNode

    const analyser = contextRef.current.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    analyserRef.current = analyser

    // Audio graph: worklet -> analyser -> destination
    workletNode.connect(analyser)
    analyser.connect(contextRef.current.destination)

    // Listen for buffer requests from the worklet
    workletNode.port.onmessage = (e) => {
      if (e.data.type === 'need-data') {
        if (pumpBuffersRef.current) pumpBuffersRef.current()
      }
    }

    // Open and start VGM
    functionsRef.current.OpenVGMFile(track.path)
    functionsRef.current.SetLoopCount(2)  // intro + 1 loop, then advance
    functionsRef.current.PlayVGM()

    const titleParts = (track.title || '').split('|||')
    // ShowTitle format: "TITLE|||name|||GAME|||game|||SYSTEM|||system|||ARTIST|||author"
    setTrackInfo({
      title: titleParts[1] || track.name,
      game: titleParts[3] || '',
      system: titleParts[5] || '',
      author: titleParts[7] || '',
      length: track.lengthFormatted
    })

    setCurrentTrack(track)
    setCurrentTrackIndex(idx)

    // Start worklet and pump initial buffers
    workletNode.port.postMessage({ type: 'start' })
    isPlayingRef.current = true
    isGeneratingRef.current = true

    // Pump initial buffers
    if (pumpBuffersRef.current) pumpBuffersRef.current()

    setIsPlaying(true)
  }, [isReady, trackList, currentTrackIndex])

  const pause = useCallback(() => {
    if (workletNodeRef.current) {
      try { workletNodeRef.current.port.postMessage({ type: 'pause' }) } catch (e) { }
    }
    isPlayingRef.current = false
    setIsPlaying(false)
  }, [])

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      pause()
    } else if (currentTrack) {
      play(currentTrackIndex)
    } else {
      play(0)
    }
  }, [isPlaying, currentTrack, currentTrackIndex, pause, play])

  const nextTrack = useCallback(() => {
    nextTrackRef.current = nextTrack
    const nextIdx = (currentTrackIndex + 1) % trackList.length
    stop()
    setTimeout(() => play(nextIdx), 100)
  }, [currentTrackIndex, trackList.length, stop, play])

  const prevTrack = useCallback(() => {
    const prevIdx = currentTrackIndex === 0 ? trackList.length - 1 : currentTrackIndex - 1
    stop()
    setTimeout(() => play(prevIdx), 100)
  }, [currentTrackIndex, trackList.length, stop, play])

  const seek = useCallback((seconds) => {
    if (!functionsRef.current || !isPlayingRef.current) return
    const samplePos = Math.floor(seconds * sampleRateRef.current)
    functionsRef.current.Seek(samplePos)
    uiStartRef.current = Date.now() - seconds * 1000
    setElapsed(Math.floor(seconds))
  }, [])

  // Unlock AudioContext synchronously on user gesture (important for mobile)
  const resumeAudio = useCallback(() => {
    if (!contextRef.current || contextRef.current.state === 'closed') {
      window.AudioContext = window.AudioContext || window.webkitAudioContext
      contextRef.current = new AudioContext()
    }
    if (contextRef.current.state === 'suspended') {
      contextRef.current.resume()
    }
  }, [])

  // Keep nextTrack ref current to avoid stale closure in auto-advance
  useEffect(() => {
    nextTrackRef.current = nextTrack
  }, [nextTrack])

  // Load scripts
  useEffect(() => {
    const loadScript = (src) => {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve()
          return
        }
        const script = document.createElement('script')
        script.src = src
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
      })
    }

    // Set Module.locateFile BEFORE loading the script so Emscripten finds
    // vgmplay-js.wasm and vgmplay-js.data from our local public directory
    window.Module = window.Module || {}
    window.Module.locateFile = (path) => '/' + path

    Promise.all([
      loadScript('/vgmplay-js.js'),
      loadScript('/minizip-asm.min.js')
    ]).then(() => {
      const checkModule = setInterval(() => {
        try {
          if (window.Module && window.Module.calledRun && window.Module.cwrap && window.Minizip) {
            clearInterval(checkModule)
            initPlayer()
          }
        } catch (e) {
          console.error('Module check failed:', e)
        }
      }, 200)

      setTimeout(() => clearInterval(checkModule), 15000)
    }).catch(err => {
      console.error('Script loading failed:', err)
    })
  }, [initPlayer])

  // Frequency data visualizer loop
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
          for (let j = 0; j < binSize; j++) {
            const idx = i * binSize + j
            if (idx < freqUint8.length) sum += freqUint8[idx]
          }
          next[i] = Math.round(sum / binSize)
        }
        setFrequencyData(next)
      } catch (_) { }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => { if (rafId) cancelAnimationFrame(rafId) }
  }, [isPlaying])

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
      if (wakeLockRef.current) {
        try { await wakeLockRef.current.release(); wakeLockRef.current = null } catch (e) { }
      }
    }

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'hidden') {
        if (workletNodeRef.current) {
          try { workletNodeRef.current.port.postMessage({ type: 'pause' }) } catch (e) { }
        }
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

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      releaseWakeLock()
    }
  }, [isPlaying])

  // Media Session API
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    try {
      if (trackInfo) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: trackInfo.title,
          artist: trackInfo.author || 'Unknown Artist',
          album: trackInfo.game || '16-bitbox VGM Archive',
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
    } catch (e) {
      console.error('Media Session API failed:', e)
    }
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
    seek,
    resumeAudio
  }
}
