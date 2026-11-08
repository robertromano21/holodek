# Typed Recruitment Tasks

New resident requests use a Retort taskPlan object. Each available kind has its
own array and target enum. Unused kinds are empty arrays; a request selects one
to three distinct conditions total. A kind cannot select another kind's target.
Each condition has its own LLM-authored instruction, rather than one shared focus
inserted into an observation template.

Available mechanisms:

- conversation: an existing resident, an exchange enum, and authored success
  criteria. The normal live dialogue call adjudicates the current player reply.
- retrieve: a real unprotected room item, verified by its actual transfer receipt.
- read: an unread, stored chapter or inscription with contents, verified by a
  reading receipt against the actual text hash. Cover inspection is not reading.
- puzzle: an existing unsolved physical mechanism, verified by its actual state.
- defeat: an existing encountered hostile, verified by the existing defeat ledger.
- survey: a real encountered resident's existing activity, with explicitly chosen
  observation count and interval. This is only for watching change over time.
  Recording an observation requires a living, visible target in the same room.

Kinds without real local targets are omitted. Protected quest objects and empty
documents are not offered. Starter-room restrictions remain unchanged: adding a
defeat mechanism does not create hostiles in the safe starter room. Existing
recruitment, quest, consent, population and service rules remain in place.

The old unbound survey option and its automatic two-observation/two-action
defaults are not exposed in production taskPlan schemas. Ordinary examination or
information-sharing should not become timed watching. Physical instructions
display the LLM's wording followed by the actual engine completion method;
spoken conditions use normal conversation, not observe/report commands.

Both authoring paths use this schema: explicit help requests and live recruitment
dialogue. No additional model call is introduced. Text has no new character limit
and no stock task prose or proper-name examples are seeded into authoring.

Saved requests keep their original conditions and progress. In particular,
Sable's already-offered survey is not silently replaced. Test new generation in a
fresh game or with a resident who has not offered a request yet. Logs identify
taskKinds and planVersion so the selected mechanism can be verified.

After saving and closing the game, activate the exact verified release:

```powershell
pm2 restart gameServer
.\tools\update-helpers.ps1
```

The updater checks the verified source and all three selected local or website
helpers. It does not restart gameServer2 or rewrite saved worlds. Automated tests
use fake model transport; browser testing is still required.
