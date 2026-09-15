# Media choice interactions

Date: 2026-09-15  
Status: Implemented

`mediaChoice` is a reusable interaction for asking somebody to select, remove,
or rank video-backed options and optionally explain the decision. It is
available in project opening interactions, per-session opening overrides,
onboarding step configuration, the public API, the React SDK, and the COLORS
doorcheck preview.

## Question contract

```json
{
  "inputType": "mediaChoice",
  "mediaChoice": {
    "id": "programme-room-v1",
    "options": [
      {
        "id": "artist-a",
        "label": "Artist A — Track A",
        "description": "A short optional editorial note.",
        "media": {
          "type": "video",
          "provider": "youtube",
          "videoId": "abcDEF_1234",
          "title": "Artist A — Track A | A COLORS SHOW",
          "artist": "Artist A",
          "thumbnailUrl": "/images/artist-a.jpg",
          "durationSeconds": 198,
          "startSeconds": 12,
          "captionsUrl": "https://example.com/artist-a-captions.vtt",
          "transcript": "Optional short accessible transcript.",
          "alt": "Artist A performing in the COLORS studio"
        }
      },
      {
        "id": "artist-b",
        "label": "Artist B — Track B",
        "media": {
          "type": "video",
          "provider": "youtube",
          "videoId": "xyzDEF_5678",
          "title": "Artist B — Track B | A COLORS SHOW",
          "alt": "Artist B performing in the COLORS studio"
        }
      }
    ],
    "selection": {
      "mode": "rank",
      "minSelections": 2,
      "maxSelections": 2
    },
    "rationale": {
      "required": true,
      "prompt": "What do you want the room to feel as the programme changes?",
      "minLength": 24,
      "maxLength": 1200
    }
  }
}
```

Use between two and eight options. IDs must be stable and unique within the
question. Supply a YouTube video ID rather than a full embed URL. Thumbnail and
caption URLs must be HTTPS or application-relative paths.

The normaliser rejects an interaction when:

- fewer than two valid, uniquely identified media options remain;
- a video is missing its title, accessible alternative or valid YouTube ID;
- the selection mode is not `select`, `remove`, or `rank`;
- limits fall outside the available options or the minimum exceeds the maximum;
- rationale length rules are contradictory.

## Selection modes

| Mode | Meaning of submitted `optionIds` | Ordering |
| --- | --- | --- |
| `select` | Options chosen for inclusion | Preserved, but not scored as a ranking |
| `remove` | Options chosen for exclusion | Preserved, but not scored as a ranking |
| `rank` | Options chosen for inclusion | First ID is rank 1, second is rank 2, and so on |

`minSelections` and `maxSelections` apply to the submitted IDs. For an exact
choice, set both to the same number.

## Structured answer

Clients submit a readable `message` for backward compatibility and the
structured answer alongside it:

```json
{
  "message": "Ranked: 1. Artist B — Track B; 2. Artist A — Track A\nReason: The contrast creates a clear emotional arc.",
  "interactionAnswer": {
    "type": "mediaChoice",
    "questionId": "programme-room-v1",
    "mode": "rank",
    "optionIds": ["artist-b", "artist-a"],
    "rationale": "The contrast creates a clear emotional arc."
  }
}
```

The server does not trust the readable client message. It checks the structured
answer against the active assistant question, reconstructs the transcript text
from trusted option labels, and stores the validated object as
`messages.metadata.interaction_answer`.

A mismatched question ID or mode, unknown or duplicate option, broken selection
limit, or invalid rationale produces HTTP 400 before a user message is stored.

## React SDK

`GatekeeperV2` renders media questions automatically through
`InteractionInput`. For custom composition, use `MediaChoiceInput` directly:

```tsx
import {
  MediaChoiceInput,
  type MediaChoiceInputProps,
} from "@groucho-gatekeeper/sdk/react"

function Question(props: MediaChoiceInputProps) {
  return <MediaChoiceInput {...props} />
}
```

`MediaChoiceInput` returns both the readable message and structured answer. Pass
both to `client.sendMessage`:

```ts
await client.sendMessage(sessionId, {
  message,
  interactionAnswer: answer,
})
```

The default renderer:

- loads posters first and creates only one YouTube iframe at a time;
- uses `youtube-nocookie.com` for embedded playback;
- exposes selected state with text, contrast and `aria-pressed`;
- prevents over-selection and disables submission below the minimum;
- provides explicit earlier/later controls for ranking;
- exposes optional transcript and caption resources;
- stacks cards on narrow screens and maintains 40–44 px control targets;
- removes non-essential transitions when reduced motion is requested.

## Project configuration

For a gatekeeper project, set the opening question under
`application_experience`:

```json
{
  "application_experience": {
    "opening_message": "Four artists. One room. Choose and order two.",
    "opening_interaction": {
      "inputType": "mediaChoice",
      "mediaChoice": {
        "id": "programme-room-v1",
        "options": [],
        "selection": {
          "mode": "rank",
          "minSelections": 2,
          "maxSelections": 2
        },
        "rationale": {
          "required": true,
          "prompt": "Tell us why.",
          "minLength": 24,
          "maxLength": 1200
        }
      }
    }
  }
}
```

Replace the empty example options with at least two complete option objects.
The project editor includes a JSON configuration field when “Media choice with
rationale” is selected. The public `startSession` call can also pass the same
object as `openingInteraction` for a per-session override.

For an onboarding project, use the same interaction object on a flow step. The
runtime validates its answer against the active step before advancing.

## Testing with the official COLORS playlist

The authenticated COLORS doorcheck preview can create a temporary media
question from the latest four full performances in the official `ALL COLORS
SHOWS` YouTube playlist. Open **Settings**, choose **Remove one**, **Select top
three**, or **Rank top three**, then choose **Start media test**.

The server reads YouTube's no-key Atom feed for the fixed official playlist ID
`PLWa4R2I19VH7Mtxo3VvqwnNlXgLpf4_d3`. It verifies the channel ID
`UC2Qw1dzXDBAZPwS7zm37g8g`, rejects Shorts and non-show formats, keeps only
titles ending in `A COLORS SHOW`, and caches the upstream result for 15 minutes.
The browser receives only the normalised media-choice interaction; it does not
fetch or parse the playlist itself.

The same exercise is now integrated into the adaptive COLORS test flow. After
the second applicant answer, Groucho may replace its next cultural-point-of-view
prompt with a **remove one + rationale** exercise built from the latest four
official full shows. It is inserted at most once per conversation and only when
that evidence goal is still open. The selected option and rationale are stored
as the structured answer described above, so the following adaptive turn can
continue normally.

Automatic placement is limited to project previews, projects whose environment
is `test`, and `dry-run` sessions. Live projects are unchanged. If the official
feed is unavailable or does not provide four valid full shows, Groucho keeps the
normal text question instead of failing the conversation.

This testing control creates a fresh dry-run conversation and does not modify
the saved project configuration. Promote a tested question by saving explicit
video IDs and editorial metadata in the project editor, so a live application
does not change whenever the playlist changes.

## Completion payloads

Validated media answers remain visible in the authenticated admin transcript
metadata. Non-dry-run `session.completed` webhook payloads also contain a compact
snake-case representation:

```json
{
  "interaction_answers": [
    {
      "type": "media_choice",
      "question_id": "programme-room-v1",
      "mode": "rank",
      "option_ids": ["artist-b", "artist-a"],
      "rationale": "The contrast creates a clear emotional arc."
    }
  ]
}
```

This keeps downstream analysis independent of transcript wording and preserves
the exact choice order.

## Editorial and privacy boundaries

- Use official or licensed media and accurate accessible descriptions.
- Do not autoplay.
- Do not require every clip to be watched.
- Prefer locally hosted posters to avoid unnecessary third-party image requests.
- Treat play progress as interface state, not applicant evidence.
- Assess the explanation and curatorial reasoning, not agreement with an
  assumed correct artist choice.
- Do not let a conversational model invent media, IDs or selection rules. Rich
  interactions must come from trusted project or host configuration.
