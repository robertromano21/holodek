# Required Direct Dialogue Responses

The logged Ivrin turn correctly detected the named resident, but `story-scene` chose an empty speaker list. The engine accepted atmospheric narration with zero spoken passages.

The response compiler now owns speaker requirements. Every reachable, explicitly named addressee receives a live reply; an addressed group needs at least one relevant responder, not a crowded-room chorus. This uses the existing audience detection and perception rules. It does not give distant or undiscovered characters remote knowledge.

Omitting an addressee from the planner's speaker list does not retry that planning request. The engine adds the required voice and uses the normal live-speech authoring call. The reply is addressed to PC and holds attention instead of being classified as passing chatter. A refusal, admission of ignorance, or hostile announcement is valid; it does not imply cooperation, recruitment, knowledge disclosure, an attack roll or damage. Creatures without words can vocalize without acquiring an invented language.

The same required-response check handles directly addressed party members and non-local models, even without service/recruitment options. Valid flowing narration and grounded companion reactions are unchanged. If non-local narration omits a required voice, a reply-only call supplies the missing answer without rewriting the scene or refreshing all caches again. Normal exploration, idle ticks and room arrival still need no compulsory speech. Existing recruitment group approval and pre-response task adjudication are preserved.

## Recruitment Conditions

The current Tavren log revealed a separate mismatch: spoken dialogue requested solving the threshold puzzle while the typed task required giving him the ash woven mantle. New typed offers now use the LLM-authored condition instructions themselves as the live spoken offer and the committed task. No second paraphrase can silently add a different requirement; no extra model call or stock dialogue is needed. Instructions are authored in the character's voice. Any inconsistent provisional memory is discarded, not retained as something actually promised.

New puzzle recruitment offers use the existing `help-here` mode: after acceptance the recruit accompanies the player provisionally in this room; all group requirements still need completion before permanent membership. The progress sheet marks each condition Verified or Still Needed and names the waiting members instead of presenting an unexplained disabled completion button. Existing accepted saves retain their recorded conditions. A mixed puzzle/retrieval group still needs the actual item transfer; finding an item alone is not a handoff.

Only actual extracted speech counts. Cached future alternatives do not satisfy a response. Story diagnostics record the directed audience and any unanswered names. Provider failures still produce explicit errors; no canned character answer is substituted and no live session is replayed during testing.

Offline regression: `node --test tests/direct-dialogue-response.test.cjs tests/dialogue-audience.test.cjs tests/dialogue-speech-boundary.test.cjs tests/group-recruitment.test.cjs tests/conversation-adjudication.test.cjs`.

After exact-release verification, close and relaunch Holodek and run `./tools/update-helpers.ps1`. The updater checks the current PC engine and all three selected helper slots without restarting either server or altering saved games.
