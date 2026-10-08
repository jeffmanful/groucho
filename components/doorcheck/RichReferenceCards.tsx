import type { ReferenceCard } from "@/lib/gatekeeper-interaction-spec"

export function RichReferenceCards({ cards }: { cards: ReferenceCard[] }) {
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2" aria-label="References for this question">
      {cards.map((card) => (
        <a
          key={card.id}
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${card.title} on YouTube in a new tab`}
          className="group flex min-h-11 flex-col overflow-hidden rounded-xl border border-white/15 bg-white/[0.035] text-white/85 transition-[border-color,background-color,scale] duration-150 ease-out hover:border-white/35 hover:bg-white/[0.065] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {card.kind === "image" && card.imageUrl ? (
            <div className="aspect-video overflow-hidden bg-zinc-950 outline -outline-offset-1 outline-white/10">
              {/* Official COLORS thumbnails are externally hosted, as with MediaChoiceInput. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.imageUrl}
                alt={card.alt ?? card.title}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}
          <span className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
            <span className="flex flex-col gap-1">
              <span className="text-pretty text-sm leading-snug">{card.title}</span>
              <span className="text-xs text-white/45">Open performance on YouTube</span>
            </span>
            <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-white/55 transition-colors group-hover:text-white" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M7 17 17 7M8 7h9v9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </a>
      ))}
    </div>
  )
}
