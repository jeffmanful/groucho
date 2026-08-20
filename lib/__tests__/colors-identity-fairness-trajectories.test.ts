import { describe, expect, it } from "vitest"
import {
  applicationSignalDefinitions,
  applicationSignalDefinitionsForOrientation,
} from "@/lib/application-signal-state"
import {
  EMPTY_APPLICATION_PARTICIPANT_ORIENTATION,
  inferApplicationParticipantOrientation,
} from "@/lib/application-participant-orientation"

const definitions = applicationSignalDefinitions([
  "What brought you here?",
  "Name an artist more people should know about. What would you want someone hearing them for the first time to notice?",
  "What's the last song you recommended, and why did you think it was worth sharing?",
  "Someone shares unfinished music that isn't really for you. How would you respond?",
  "Which sounds most like you?",
  "What's one thing you could realistically contribute in your first month?",
])

function orientationAfter(answers: string[]) {
  return answers.reduce(
    (previous, currentAnswer) =>
      inferApplicationParticipantOrientation({ previous, currentAnswer }),
    EMPTY_APPLICATION_PARTICIPANT_ORIENTATION,
  )
}

function routedClusters(answers: string[]) {
  return applicationSignalDefinitionsForOrientation(
    definitions,
    orientationAfter(answers),
  ).map((signal) => signal.cluster)
}

describe("COLORS identity and fairness trajectories", () => {
  it.each([
    {
      identity: "artist",
      answers: [
        "I make electronic music and want an honest exchange around process.",
        "The small scene around me has taught me to leave rough edges in the work.",
      ],
      expected: "artist",
      feedbackRelevant: false,
    },
    {
      identity: "curator",
      answers: [
        "I host a monthly listening night and introduce local artists with context.",
        "People rely on me to keep the quieter work from being overlooked.",
      ],
      expected: "curator",
      feedbackRelevant: true,
    },
    {
      identity: "enthusiast",
      answers: [
        "I mostly listen and want a community where people return to music slowly.",
        "I share one song with friends and come back after we have lived with it.",
      ],
      expected: "enthusiast",
      feedbackRelevant: false,
    },
    {
      identity: "hybrid",
      answers: [
        "I produce my own music and run a small radio show for local releases.",
        "I make work, curate the show, and connect artists when the fit is real.",
      ],
      expected: "hybrid",
      feedbackRelevant: true,
    },
  ])(
    "routes the $identity trajectory through relevant evidence",
    ({ answers, expected, feedbackRelevant }) => {
      const orientation = orientationAfter(answers)
      const clusters = routedClusters(answers)

      expect(orientation.primary).toBe(expected)
      expect(clusters).toContain("colors_relationship")
      expect(clusters).toContain("participation_and_contribution")
      expect(clusters.includes("care_and_feedback")).toBe(feedbackRelevant)
    },
  )

  it("does not let city prestige create scene evidence", () => {
    const prestigious = orientationAfter(["I live in London."])
    const lessGloballyVisible = orientationAfter(["I live in Kumasi."])

    expect(prestigious).toEqual(lessGloballyVisible)
    expect(prestigious.primary).toBe("unknown")
  })

  it("treats equivalent local and online scene participation consistently", () => {
    const local = orientationAfter([
      "I host a small local listening group and share context for each artist.",
    ])
    const online = orientationAfter([
      "I host a small online listening group and share context for each artist.",
    ])

    expect(local.primary).toBe("curator")
    expect(online.primary).toBe("curator")
    expect(local.scores).toEqual(online.scores)
    expect(routedClusters([
      "I host a small local listening group and share context for each artist.",
    ])).toEqual(routedClusters([
      "I host a small online listening group and share context for each artist.",
    ]))
  })

  it("does not require polished English to recognise a listener", () => {
    const concise = orientationAfter(["I mostly listen. Music community important to me."])
    const polished = orientationAfter([
      "I am primarily a listener, and thoughtful music communities are important to me.",
    ])

    expect(concise.primary).toBe("enthusiast")
    expect(polished.primary).toBe("enthusiast")
    expect(concise.scores.enthusiast).toBe(polished.scores.enthusiast)
  })

  it("does not infer status from familiar or unfamiliar artist references", () => {
    const familiar = orientationAfter(["I keep returning to Beyoncé's work."])
    const unfamiliar = orientationAfter(["I keep returning to Aster Nuru's work."])

    expect(familiar.primary).toBe("unknown")
    expect(unfamiliar.primary).toBe("unknown")
    expect(familiar.scores).toEqual(unfamiliar.scores)
  })
})
