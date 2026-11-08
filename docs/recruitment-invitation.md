# Recruitment Invitation

Recruitment requests now open directly as **Recruitment Invitation**, showing the resident, full saved request, joining conditions and **Accept Request**, **Decline Request**, and **Not Now**. Encounter delivery and clicking the resident share this presentation. There is no intermediate job list, currency header or duplicated request description. Not Now preserves the offer and allows the ordinary character sheet; reopening the invitation shows the request again.

After acceptance, reopening shows the saved progress and Report Findings instead of offering acceptance again. Completion still requires real objective evidence before the resident joins. A resident who also operates a shop, temple or other service retains a separate Access Services action. Ordinary economic contracts keep their existing labels and mechanics.

The journal lists these requests under Recruitment Invitations, separately from ordinary Local Contracts. Existing progress and joined-party receipts are retained.

## Player Agency

The logged failure offered Sella's request on approach, then treated `tell monsters my tale and ask if they would join my quest` as acceptance because the NPC chose `accept-favor`. That action is now unavailable unless the actual player input explicitly agrees to an existing, unambiguous request. The same binding guards rejection. Engine-generated option data carries the player decision; NPC-authored fields cannot supply it. Recruitment consent, conditional invitation and player request acceptance remain separate.

Natural-language agreement such as `Yes, we'll help with that` remains supported for an unambiguous offered request. If the intent or target is ambiguous, the request remains offered and the direct popup supplies the choice. No clarification model call is needed. The canonical typed commands are `accept request from NAME` and `decline request from NAME`; the old favor commands and saved mission identifiers remain compatible.

## Verification And Activation

Tests cover the logged ordering bug, forbidden model acceptance, explicit player agreement, target ambiguity, command aliases, direct automatic/clicked/synchronized popup paths, accepted progress, deferral, decline and coexistence with real services. No saved games are rewritten, no model requests are made during verification, and neither server is restarted by the agent.

Save and close the game, run `pm2 restart gameServer`, then `.\tools\update-helpers.ps1`. Reopen and reload the save. Existing accepted requests stay accepted; the update does not guess whether an earlier saved acceptance was legitimate. `gameServer2` remains untouched.
