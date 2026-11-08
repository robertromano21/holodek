# Group Recruitment Review

A recruitment invitation to one named resident now addresses the encountered,
audible members of that encounter group. It does not invite everyone in a city,
reach unseen residents, recruit hostile actors, or bypass quest/guardian rules.
The console Add to Party path uses the same live conversation as a click.

Each participant can agree, decline, or author their own typed, grounded request.
Ordinary service jobs still use the one-job-per-group policy. Recruitment requests
instead link to a shared run/room/floor-scoped invitation. The designated CotG
starter contact still supplies a favor; guardians and actual refusals stay behind.
The LLM must not put an untracked joining condition inside a refusal.
Repeated named Add to Party attempts on a resident who already refused reuse
their saved live reply and return before model generation. They do not reroll
consent, create another task, or reopen the willing members' shared review.

Every live response is authored before social actions are committed. A group
remains collecting until all required participants have an engine-recorded reply.
The review popup waits for the entire live speech queue, not just its offerer.
It lists all recorded requirements, willing members, and residents staying behind.
While open, a reversible dialogue hold stops subtitle/voice playback and ambient
dialogue polling without setting the engine pause flag or blocking its buttons.
Close, decision, scope changes and reset release that hold.

One approval preflights and accepts all bound tasks. A generic natural acceptance
also resolves to the shared request rather than ambiguous individual jobs.
Conversation conditions still use model adjudication of the actual player input;
physical conditions still require their engine evidence. Willing members join
together only after every agreed condition is verified. Consent without conditions
is also held until the last participant has answered. Party limits, saved character
identity, inventory, source/run/floor guards and persistent refusals are retained.

After review, approaching the resident cannot reopen a progress/report popup.
Clicking opens the ordinary character sheet. Recruitment Progress explicitly
opens the full loop; Complete Party Invitation is a separate action, enabled when
the shared requirements are ready. That action preflights every outstanding
physical receipt before completing any task, recruits the willing members, and
uses the existing authored acknowledgment path. Duplicate transaction nonces do
not award or recruit twice. Existing saves and individual requests remain valid;
untracked past prose is not silently promoted into a new task.
Willing members without a task of their own expose the same shared progress.

## Activation

Save and close the game, then run:

```powershell
pm2 restart gameServer
.\tools\update-helpers.ps1
```

No new game is needed. Use the next actual invitation to review a group exchange.
The updater verifies the exact PC release and selected local or website helpers.
gameServer2 is untouched. Automated checks use fake model transport; live browser
verification remains necessary.
