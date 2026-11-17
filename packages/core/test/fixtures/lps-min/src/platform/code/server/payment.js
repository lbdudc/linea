/*% if (feature.Payment) { %*/
export const payment = {
  creditCard: /*%= !!feature.CreditCard %*/,
  cash: /*%= !!feature.Cash %*/,
};
/*% } %*/
