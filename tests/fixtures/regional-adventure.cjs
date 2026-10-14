'use strict';
module.exports = () => ({
  title: 'The Water Debt', premise: 'Recover a missing witness and settle who will protect the spring road.',
  hook: 'Someone took our well surveyor. Find the records before believing the caravan rumors.',
  rumor: 'The surveyor sold the spring to the toll wardens.', investigation: 'Read the register to check that accusation.',
  rescue: 'I was taken for refusing the levy. I will travel with you, not another hired warden.',
  conclusion: 'The road must have stewards. Decide whether the households or the caravan fellowship should maintain it.',
  sites: ['Amber Spring Gardens', 'Crown Burial Grounds', 'Cinder Caravan Road', 'Temple of the Chained Levy'].map(name => ({ name, flavor: 'A lived-in place marked by water rights and disputed tolls.' })),
  actors: ['Senna Wellwright', 'Varo Reedkeeper', 'Marl Stonegrip', 'Kelan Tollhand', 'Dora Chainward', 'Iris Oathguard']
    .map(name => ({ name, history: 'A surveyor once accused this soul of taking an unlawful toll.', personality: 'Practical, stubborn, and wary of broken promises.' })),
  burialText: 'The witness refused the levy. The wardens carried them along the road to their temple, not to the river.',
  testimonyText: 'The prison register records the unlawful levy and the transfer of the missing surveyor.'
});
