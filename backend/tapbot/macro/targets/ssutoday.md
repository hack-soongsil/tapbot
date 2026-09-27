# SSUTODAY macro targets

Observed on `2026-09-27` from package `com.ssutoday`, window title
`슈투데이`, on a `1080x2280` logical display.

## Study room 2C card

- Clickable UI-tree node path:
  `n0.0.0.0.0.0.0.0.0.0.1.1.1.0.0.0.0.0.0.0.9.2`
- Class: `android.view.View`
- Visible and enabled: `true`
- Bounds at capture time: `(44, 1527)-(1034, 1945)`
- Successful tap point used during verification: `(565, 1690)`
- Child image node: path suffix `.0`, content description `스터디룸 2C`
- Child title node: path suffix `.3`, text `스터디룸 2C`
- Card content description begins with:
  `스터디룸 2C 10인실 2층 중앙계단 옆`
- Expected result after activation: the detail tree contains `스터디룸 2C`,
  `콘센트 6구`, `칠판`, `시간 선택`, and `이용 규칙`.

The positional node path and bounds are diagnostic references, not stable
selectors. A production macro should resolve the clickable ancestor whose
content description starts with `스터디룸 2C `, scoped to package
`com.ssutoday`, and verify the detail-screen labels after the action.

## Time-slot selection

Reference implementation: `jonghokim27/ssutoday-v3` at commit
`328a26e5cce591ea9410152f8bf48f080f5e346e`.

- The timeline runs from `06:00` through `22:00` as 32 half-hour slots.
- UI-tree slot nodes share the prefix
  `n0.0.0.0.0.0.0.0.0.0.1.1.1.0.0.0.0.0.0.0.1.6.0.` and use the
  zero-based slot index as the final component.
- Convert a desired start time to a slot with
  `(minutes_since_midnight - 06:00) / 30`.
- The first slot tap sets both ends of the selection to that slot.
- When only one slot is selected, tapping a different slot selects the
  inclusive range between the two slots. Either endpoint may be tapped first.
- The displayed end time is the end of the last selected half-hour slot. For
  example, `21:00 ~ 22:00` is produced by tapping slot `30` (`21:00`) and slot
  `31` (`21:30`), not by tapping a separate `22:00` slot.
- A normal user may select at most four contiguous slots (two hours). A second
  endpoint beyond that limit is rejected and leaves the prior selection in
  place.
- Once a multi-slot range exists, another slot tap resets the selection to
  that single slot; it does not extend the existing range.
- Do not target disabled, booked, or past slots. Validate every slot inside
  the proposed range, not only its endpoints.
- For today's date, a completed slot is past. The source also treats the
  currently running half-hour as `current` for its first 15 minutes and as
  `past` afterward. A macro should prefer strictly future slots.
- Verify success from the summary node text (`HH:MM ~ HH:MM`) before touching
  the reservation CTA.

Observed reservation CTA node path:
`n0.0.0.0.0.0.0.0.0.0.1.1.1.0.0.0.0.0.0.0.2.0`. Its source label changes
from `시간을 선택하세요` to `이 시간으로 예약하기` when a selection exists,
but the WebView accessibility snapshot may lag behind the visual state. Treat
the summary node as the primary selection confirmation and re-read the CTA
before activating it.

## Detail-screen back button

- UI-tree node path:
  `n0.0.0.0.0.0.0.0.0.0.1.1.1.0.0.0.0.0.0.0.0`
- Class: `android.widget.Button`
- Visible, enabled, clickable, and focusable: `true`
- Bounds at capture time: `(55, 107)-(168, 223)`
- The accessibility snapshot exposes neither text nor content description for
  this icon button.

Resolve it only after verifying the detail screen, as the sole enabled
clickable button in the upper-left navigation area. Prefer the Android `back`
primitive when the macro only needs standard back navigation; use this UI node
when the app-specific button behavior must be exercised.
