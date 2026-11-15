// NOT EXECUTED. Actual production permit helper + actual Host bookkeeping.
// Authored lifecycle obligations only. No fake Dreamer/continuum/provider/UI/DB.
// This file proves neither real entropy nor original store integration.
import assert from 'node:assert/strict';
import { installPreparationHost } from '../../services/lifecycle/bootstrapAuthority';
import { dreamerOwner } from '../../services/lifecycle/preparationBindings';
import { AdmissionClosed, OwnershipConflict } from '../../services/lifecycle/host';
import {
 reserveInitialConceptNotification, reserveInitialIdentityNotification, reserveCanonicalStoreNotification,
 claimContinuumNotification, takeContinuumNotification, finishContinuumNotification,
 skipContinuumNotification, abandonContinuumNotification, cancelNewContinuumNotifications,
 joinAcceptedContinuumNotifications,
} from '../../services/lifecycle/continuumDreamerNotification';
import { projectRetainedFailureCategories } from '../../services/lifecycle/retainedFailureCategories';
const host = installPreparationHost({scopes:128,active:512,failures:64,resources:256});
const owner = dreamerOwner();
const concept = reserveInitialConceptNotification();
const identity = reserveInitialIdentityNotification();
const failedWrite = reserveCanonicalStoreNotification();
const failure = new Error('AUTHORED_LIFECYCLE_OBLIGATION_FAILURE_NOT_PROVIDER_RESULT');
const privateMarker = 'AUTHORED_NONEXPORTED_SENTINEL';
const foreign = Object.freeze({}) as typeof concept;
assert.throws(() => claimContinuumNotification(foreign), OwnershipConflict);
const conceptClaim = claimContinuumNotification(concept);
assert.throws(() => claimContinuumNotification(concept), OwnershipConflict);
// The real no-store identity guard and canonical failure will be exercised by
// separately defined original integration tests. Here test actual disposal APIs.
skipContinuumNotification(identity);
assert.throws(() => skipContinuumNotification(identity), OwnershipConflict);
const failedClaim = claimContinuumNotification(failedWrite);
abandonContinuumNotification(failedClaim, failure);
assert.throws(() => abandonContinuumNotification(failedWrite, failure), OwnershipConflict);
// A pending same reservation blocks real final join; release actual lifecycle
// Promise explicitly, never sleep as a proxy for completion.
cancelNewContinuumNotifications();
assert.throws(() => reserveCanonicalStoreNotification(), AdmissionClosed);
const child = takeContinuumNotification(conceptClaim);
assert.throws(() => takeContinuumNotification(conceptClaim), OwnershipConflict);
let settle!: () => void;
const obligation = new Promise<void>(resolve => { settle = resolve; });
const original = owner.invokeChild(child, () => obligation);
let joined = false;
const final = joinAcceptedContinuumNotifications().then(() => { joined = true; });
await new Promise<void>(resolve => setImmediate(resolve));
assert.equal(joined, false);
settle(); await original; finishContinuumNotification(conceptClaim); await final;
assert.throws(() => finishContinuumNotification(conceptClaim), OwnershipConflict);
owner.failure('UNLISTED_SOURCE_' + privateMarker, { privateMarker });
owner.taskFailed('service-fixture-outcome', failure);
const report = await host.stop();
const originals = report.failures.map(record => record.original);
const before = [report.ownerFailures, report.taskOutcomeFailures, report.lifetimeFailures, report.acknowledged];
const projected = projectRetainedFailureCategories(report);
assert.deepEqual(report.failures.map(record => record.original), originals);
assert.deepEqual([report.ownerFailures,report.taskOutcomeFailures,report.lifetimeFailures,report.acknowledged], before);
assert.equal(projected.retained.length, report.failures.length);
assert.ok(projected.unclassifiedCount >= 2);
assert.equal(projected.attribution, 'INCOMPLETE');
assert.equal(JSON.stringify(projected).includes(privateMarker), false);
assert.equal(JSON.stringify(projected).includes(failure.message), false);
assert.ok(report.failures.some(record => record.original === failure));
assert.equal(report.state, 'INCOMPLETE'); // Original task failures/unsafe marker remain.
console.log('FINITE_PRODUCTION_PERMIT_HOST_ASSERTIONS_ONLY_NOT_PRODUCT_PASS');
