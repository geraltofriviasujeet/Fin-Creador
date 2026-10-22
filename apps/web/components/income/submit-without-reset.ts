"use client"

import { type FormEvent, startTransition } from "react"

/**
 * onSubmit handler that runs a form action without React 19's automatic form reset.
 * With <form action={fn}>, React resets the form after the action; selects then snap to
 * their first option while their React state keeps the old value, so the screen and the
 * submitted data disagree after a validation error. Submitting this way keeps every
 * field exactly as the person left it. (React docs: useActionState / form reset.)
 */
export function submitWithoutReset(action: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(() => action(formData))
  }
}
