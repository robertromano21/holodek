# Resident favors

Resident visibility checks the centre and exposed body points sized from the procedural character's saved stature (or the same generator's deterministic fallback for population records without sprites). Normal creatures use a 0.3-tile radius; larger creatures use up to 0.6 tiles. A centre hidden behind a cliff or wall corner no longer removes a resident whose body is visible around that corner. The room list, first sightings, conversation and recruitment use this same check. Solid walls, closed doors and pending discovery still block visibility; strict combat and movement rays are unchanged.

Player-initiated resident conversations and the nearby Monsters in Room console view reach 32 tiles. Visible residents in that range can be noticed and answer the same invitation; pending or occluded strangers remain undiscovered. Ambient resident chatter stays at 10 tiles, companion conversation at 8, and combat and item handoffs keep their existing distances. Walls and room boundaries still constrain conversation.

A committed `recruited` population record promotes the existing world actor to companion before visibility filtering. An early population push therefore cannot hide the new companion while the turn's complete roster is still in flight. This preserves the actor's HP, sprite and current position.

Unmistakable player invitations bind the scene interaction enum to recruitment. The model still chooses consent, a grounded conditional favor, discussion of a standing bargain or a firm refusal; it cannot downgrade the invitation to conversation or return `none`. This also checks the live reply's invitation flag. Other naturally expressed invitations remain classified by the scene model.

The scene receives an explicit list of nearby residents, including friendly monsters. Claims that no residents are present are rejected while that list is populated, and the scene cannot announce that nobody joins before the live replies decide it. `ResidentInteraction` diagnostics record the chosen interaction and available actions. A refusal does not guarantee a job: an actual firm refusal remains a valid recorded outcome.

Each monster group has one favor and one contact. The dialogue enums offer the creation action to one spokesperson per group, and the engine rejects a second group job across later turns, help requests, encounters and save reloads. Other groups can have their own favors. Group identity includes the adventure, room and floor. Only the named resident's actual consent grants recruitment; completing a job does not recruit the whole group.

On refresh, old duplicate offers that have not been accepted are withdrawn in favor of the accepted job (or the first offer). Accepted work and its evidence are retained. A withdrawn offer cannot be accepted and no longer imposes a recruitment condition. Recruitment still requires actual consent.

Accepting an offer closes its popup. An offered or accepted recruitment favor hides Add to Party in the contract menu, service invitation and character sheet; the server continues enforcing the condition for typed commands.

Offering to help a nearby, encountered peaceful resident can create a local
contract based on that resident's work, activity and motivation. This uses the
existing Local Contract menu and journal, independently of the main quest.
Live dialogue is also an interaction trigger. A natural invitation inside a
tale or conversation can lead to immediate consent, a concrete favor as a
counteroffer, discussion of an existing bargain, or a clear personal refusal.
The resident's structured live reply drives the action; cached speech and idle
remarks cannot recruit anyone. An accepted invitation adds the original
resident to the party immediately, without clicking the character afterward.
Party members, divine visitors, main-quest recruitment contacts and the starter
room retain their existing rules.

The LLM constructs the mission and its conditions from the actual dialogue,
personality and world facts. It selects one to three required conditions using
Retort enums: observe the location, recover and hand over an existing
unprotected object, or defeat an encountered hostile outside the main quest.
Observation counts (one to three) and intervals (one, two, three or five game
actions) are also enum choices. Conditions can form a compound side mission;
every condition must be verified before reporting can finish it. The model
authors the story and terms; the engine binds the targets and verifies proof.
It cannot create an imaginary object or declare success without evidence.

For example, asking the wind observers how to help can offer a survey favor.
Accept it from Local Contract or with `accept favor from [name]`. Use
`observe for [name]` in the bound room/floor for the number and spacing chosen
in that mission, then `report to [name]` at close speaking range.
Retrieval requires the real item-transfer receipt; defeat uses the existing
engine defeat evidence. Reporting checks the objective again.

The completed favor earns its named resident's invitation. A prior invitation
accepted conditionally is fulfilled when the completed favor is reported:
the consenting resident joins without another click. Otherwise, invite them in
conversation; Add to Party and `add [name] to party` remain alternatives.
Acceptance, declining and reporting a favor can also occur through actual
dialogue; completion still requires the same engine evidence.
Equipment, stats, appearance and abilities remain attached to the original
character. Full parties retain the earned invitation for later. The contract,
evidence and reward receipt survive saves and stale client synchronization.
Repeating help reopens the same favor; declining does not accept it, and a
later offer of help can renew the offer. A giver's death fails their personal
bargain without inventing a replacement recruit.

Observation and report commands require actual engine actions and current
scope. Dialogue may choose an interaction but claims of completion cannot
supply proof. Ordinary starting-room recruitment remains available while its
existing restriction on local work remains intact.
The journal and Local Contract menu show progress. `[ResidentFavor]` server
records identify offers, completion, recruitment and authoring errors;
`[ResidentDialogueAction]` records the committed dialogue action. Existing saves
gain these outcomes through their next real conversation after installing this
release. Each purposeful exchange should develop the resident's own concerns,
share useful information or offer a meaningful choice, rather than repeating
empty hedging. Past conversations are not rewritten.
# Dialogue and encounter delivery

Live resident dialogue uses the same enum actions on every selected game model. Recruitment invitations can produce immediate consent, a concrete favor, or a clear refusal; a refusal does not force recruitment or an invented bargain.

First-approach encounters may also propose favors without a help keyword. Encounter proposals commit only after room, run, population and history checks pass. An approach grants neither player acceptance nor a recruitment invitation. Offered favors appear in the journal's Local Contracts before acceptance.

Speech already delivered in the Game Log enters subtitles regardless of distance, occlusion, entry range hints or actor positioning. Ambient speech retains its hearing checks, and stale rooms/runs remain excluded.


Recruitment clicks and legacy typed Add-to-Party commands submit a real dialogue invitation. Friendly disposition alone is never consent. A firm live refusal is persisted per resident and run, removes accept-invitation from subsequent dialogue enums, and blocks direct recruitment and old click endpoints. Repeating the invitation, moving, waiting or reloading cannot clear it. Verified completion of an agreed resident favor records a receipt and reopens recruitment; reopening/accepting a favor alone cannot. Stale browser database, console and roster snapshots preserve the refusal.

Fresh neutral invitations roll once: values below 0.7 require refusal, values at or above 0.7 require a favor-first offer when the group can offer work. The pending result survives generation failures and retries. The model chooses the available favor conditions through enums; it cannot reroll, accept for the player, or grant free recruitment. A spoken refusal persists rather than rerolling on later invitations. Existing group-offer limits and verified completion still apply. Inviting a visible hostile resident immediately uses the enemy-initiated combat path, including when the invitation came from a click.
