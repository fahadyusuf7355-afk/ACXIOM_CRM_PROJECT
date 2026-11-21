module.exports = {
  User: require('./User'),
  Role: require('./Role'),
  Customer: require('./Customer'),
  Lead: require('./Lead'),
  Opportunity: require('./Opportunity'),
  FollowUp: require('./FollowUp'),
  Activity: require('./Activity'),
  AuditLog: require('./AuditLog'),
  RevokedToken: require('./RevokedToken'),
  ...require('./Counter')
};
