// First worker setup for this exact three-file validation only.
// No runtime imports, especially no application/service imports, before check.
if (process.env.SILHOUETTE_INFERENCE_MODE !== 'cloud-only') {
    throw new Error('VALIDATION_POLICY_REQUIRED: SILHOUETTE_INFERENCE_MODE must equal cloud-only before application imports');
}
console.log('VALIDATION_WORKER_POLICY: cloud-only');
