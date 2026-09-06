"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}

type SpeechRecognitionEventLike = Event & {
  readonly results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionErrorEventLike = Event & {
  readonly error: string
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

type UseBrowserDictationOptions = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  onStart?: () => void
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function subscribeToBrowserSupport() {
  return () => {}
}

function joinTranscript(base: string, transcript: string) {
  const spoken = transcript.trim()
  if (!spoken) return base
  if (!base) return spoken
  return `${base.trimEnd()} ${spoken}`
}

function messageForRecognitionError(error: string) {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. You can enable it in your browser settings or keep typing."
    case "audio-capture":
      return "No microphone was found. You can keep typing your answer."
    case "network":
      return "Voice input lost its connection. Your transcript is still here."
    case "no-speech":
      return "I didn’t catch that. Try speaking again or keep typing."
    default:
      return "Voice input stopped unexpectedly. Your transcript is still here."
  }
}

export function useBrowserDictation({
  value,
  onChange,
  disabled = false,
  onStart,
}: UseBrowserDictationOptions) {
  const supported = useSyncExternalStore(
    subscribeToBrowserSupport,
    () => Boolean(getRecognitionConstructor()),
    () => false,
  )
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseValueRef = useRef("")
  const onChangeRef = useRef(onChange)
  const onStartRef = useRef(onStart)

  useEffect(() => {
    onChangeRef.current = onChange
    onStartRef.current = onStart
  }, [onChange, onStart])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const cancel = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return
    recognitionRef.current = null
    recognition.onstart = null
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.abort()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    if (disabled || recognitionRef.current) return
    const Recognition = getRecognitionConstructor()
    if (!Recognition) return

    setError(null)
    baseValueRef.current = value
    onStartRef.current?.()

    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || "en-US"
    recognitionRef.current = recognition

    recognition.onstart = () => setListening(true)
    recognition.onresult = (event) => {
      let finalTranscript = ""
      let interimTranscript = ""

      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript ?? ""
        if (result?.isFinal) finalTranscript += `${transcript} `
        else interimTranscript += transcript
      }

      onChangeRef.current(
        joinTranscript(
          baseValueRef.current,
          `${finalTranscript}${interimTranscript}`,
        ),
      )
    }
    recognition.onerror = (event) => {
      if (event.error !== "aborted") {
        setError(messageForRecognitionError(event.error))
      }
    }
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null
        setListening(false)
      }
    }

    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setListening(false)
      setError("Voice input couldn’t start. You can keep typing your answer.")
    }
  }, [disabled, value])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  useEffect(() => {
    if (disabled) cancel()
  }, [cancel, disabled])

  useEffect(
    () => () => {
      const recognition = recognitionRef.current
      recognitionRef.current = null
      recognition?.abort()
    },
    [],
  )

  return { supported, listening, error, start, stop, cancel, toggle }
}
