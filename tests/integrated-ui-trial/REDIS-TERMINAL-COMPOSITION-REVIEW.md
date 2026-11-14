# V2 focused source corrections, supersedes F1fcc985

No imports/compiles/tests/composition/publication/run. Product06195e47 unchanged.

## Exact evidence contract

Fixture initializes exactly FIVE ordered result rows before production import: its ONE mode-specific scenario, terminal physical-disposition assertion, queuedraceNOTEXERCISED, nativefaultNOTEXERCISED, RedisNX/PXNOTRUN. Earlyfailure retains NOT_REACHED rather than omitting/replacing mode. Schema requires those exact names/order/status domains per mode, no global result whitelist substitution. ScenarioEXERCISED requires actual SAMEpublicbody observed and actualtimer>0. TerminalphysicalPASS requires nonemptyexacttimer observations, cancelled+fired==tracked, actualnative destroy>=cancelled, SAMEerror Hostownerfailurecount>=cancelled, exact postseal rejection and actualHostINCOMPLETE. Zero-timer cleanup is not physicalPASS.

If both scenario/terminal claim actualPASS, exact tracked/cancelled/fired tuples are natural(2,1,1), pending(1,1,0), fired(1,0,1), inflight(1,1,0), release(2,2,0), multikey(2,2,0), postseal(1,1,0), survivor(2,1,1). OPEN-DELETED forces survivor scenarioFAILED/assertionsfalse; terminalPASS still requires exact(2,1,1). No xfailgreen. assertionsComplete requires bothactualpasses and all expecteddrains fulfilled (or exactinflightsealedskip), SAMEbody/postseal. Cleanupfailure makes exit1/assertionsfalse. Product remainsINCOMPLETE regardless.

Every reflected entry field, including timer and optional cancellationError, is own DATA descriptorchecked before reads. All3requiredkeys enforced; exactplainentry/SetMap prototypes and counts remain. hostSealedEarly boolean explicitlyrecorded: true onlyinflight+SAMEbody, cleanup exactly2NOT_ATTEMPTED_HOST_ALREADY_SEALED; false requires actualfulfilled/rejected only, no mixed/skipped disguise. InflightscenarioPASS requires hostSealedEarly; missinginterleaving isNOTEXERCISED/exit1. No globaldrainclaim.

Summary requires1..8orderedrows, exactreceiptset==rowsclaimingreceipts, no extraneousreceipts. Fatal iff any timeout/groupremained/driverfailure/missingreceipt; fatalrow must be LAST and onlyfatalrow. Nonfatal forces all8/receiptsall8; zero-row/fatalfalse/partialgreen disallowed. Code↔assertionscoherence enforced on naturalrows; timeoutfailures cannot masquerade as naturalassertionred. Finalexporter uses this stricter validator on exactboundedfinalbytes and rejects unexpectedfiles via exactreceiptset.

## Conservative remaining-command reserve

UNCHANGED commandwall200 and actualrecovery5+10+5+10=30 maximum documentedtimeouts. Add5s explicitpoll/localreceipt overhead envelope percommand. Newphase gate now actualelapsed+3*(200+30+5)<1020, or+705, before Redis starts. Every command also checks actualelapsed+wall+35<1020 beforelaunch (previouswall-onlygate insufficient). No commanddeadline, TERM/wait/KILL/wait, workflow20min or180sphase is extended. This may refuseearlier existingacquisition/preflight/newphase safely; refusal isFAIL, not retroactivelytreatedas budgetsuccess.

Phasebudget itself remains8×(17execution+2forcedcontainment)=152, driver160, supervisor180. Full235sremainingouterslots cover each200wall plus30recovery plus5poll/emitmargin. When nominal three boundedcommands finish, latesttime<=1020 and final180 cleanup/export remains before1200. A machine pause/unboundedfilesystem stall cannot be hardreal-time guaranteed by any Pythonmargin; source asserts and finalwall supervisor still enforce fail-closed evidence. No measuredclaim is made. 5s includes normal0.1sselectovershoot/boundedreceiptwrite; no taskexecution uses thatmargin. Existingoutercommand asserts unchangednaturalcleangates, rawlogprivacy and providerresources remain.


## Composition scope and immutable protections
Eight exactmodes, raw mode/complete logs excluded, actualOPENsurvivor red staysFAIL,
queuedrace/nativefaultNOTEXERCISED and actualRedisNX/PXNOTRUN. InflightHostseal does
not prove serverupstream/globaldrain; explicitNOTATTEMPTEDcleanup remains. Only
redisClientproduct changes after prior1703 exactidentity. No generationfix,
publicdisconnect/TTL/Hostsemantic/provider/privacy/resource/deadline relaxation.
Current browserhiddenbody/CDPcapture cause independentlyUNKNOWN; no fix promised.
All13actualwholeFAIL remain;8previousfinite assertions realcompleted butHostINCOMPLETE.
No candidate import/compile/test/build/native/browser/commit/push/run performed.
