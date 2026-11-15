/** Real approval paths only, no provider or browser engine invoked. */
import {describe,it,expect} from 'vitest';
import {defaultPaymentApprover,bindingFor} from '../../services/payments/paymentGateway';
import {defaultPaymentApproval} from '../../services/browser/paymentApproval';
describe('payment consent unavailable contracts',()=>{
 it('gateway default approval preserves typed absent-owner reason',async()=>{
  const request={amountCents:100,currency:'USD',destination:'fixture-invalid'};
  await expect(defaultPaymentApprover({provider:'unused',direction:'collect',operation:'initiate',request,binding:bindingFor('unused','collect',request),summary:'fixture, not payment'})).rejects.toMatchObject({code:'CONFIRMATION_UNAVAILABLE',reason:'NO_AUTHENTICATED_PRINCIPAL'});
 });
 it('browser approval blocks with typed unavailable rather than claiming rejection',async()=>{
  await expect(defaultPaymentApproval({url:'https://fixture.invalid/checkout',elementText:'Pay'})).rejects.toMatchObject({code:'CONFIRMATION_UNAVAILABLE',reason:'NO_AUTHENTICATED_PRINCIPAL'});
 });
});
