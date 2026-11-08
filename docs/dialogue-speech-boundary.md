# Dialogue Speech Boundary

Live speech and future reply prompts distinguish spoken words from gestures and third-person narration for every encounter, not only recruitment invitations.

The shared dialogue parser conservatively extracts balanced double-quoted passages when surrounding text is clearly speaker attribution or stage directions. Each spoken passage gets its own backend speech label; narration retains its original position in the Game Log. Subtitles, SID input, social-action consent and subsequent dialogue context receive the spoken words only. The same treatment applies to legacy labelled responses and cached reply alternatives.

Ordinary unquoted speech, quoted names or emphasis, apostrophes, nested quotations and ambiguous or unmatched quotes are preserved rather than rejected or guessed away. This is not a natural-language classifier: ambiguous model output remains intact. The primary protection is the explicit speech-only authoring instruction.

There are no new text limits, corrective model calls, saved-character changes or campaign changes. Regression tests reproduce the logged Orvek reply and cover narration retention, legacy input, consent, caching, long speech and conservative quote handling.

After verification, save and close the game, restart only `gameServer`, run `.\tools\update-helpers.ps1`, then reopen and reload the save. `gameServer2` is untouched.
