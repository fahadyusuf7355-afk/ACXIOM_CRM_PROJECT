const { Joi, text, email, phone, oneOf, objectId, date, number, L } = require('./common');
const C = require('../config/constants');
const config = require('../config');

const P = config.passwordPolicy;

/** Password policy (section 6.2) expressed as a Joi rule. */
const password = (label = 'Password') => Joi.string().min(P.minLength).max(P.maxLength).required()
  .custom((value, helpers) => {
    if (P.requireUppercase && !/[A-Z]/.test(value)) return helpers.message(`${label} must contain at least one uppercase letter.`);
    if (P.requireLowercase && !/[a-z]/.test(value)) return helpers.message(`${label} must contain at least one lowercase letter.`);
    if (P.requireDigit && !/\d/.test(value)) return helpers.message(`${label} must contain at least one digit.`);
    if (P.requireSpecial && !/[^A-Za-z0-9]/.test(value)) return helpers.message(`${label} must contain at least one special character.`);
    if (/\s/.test(value)) return helpers.message(`${label} must not contain spaces.`);
    return value;
  })
  .messages({
    'any.required': `${label} is required.`,
    'string.empty': `${label} is required.`,
    'string.min': `${label} must be at least ${P.minLength} characters.`,
    'string.max': `${label} cannot exceed ${P.maxLength} characters.`
  });

const username = Joi.string().trim().lowercase().min(3).max(30).pattern(/^[a-z0-9._-]+$/).required().messages({
  'any.required': 'Username is required.', 'string.empty': 'Username is required.',
  'string.min': 'Username must be at least 3 characters.', 'string.max': 'Username cannot exceed 30 characters.',
  'string.pattern.base': 'Username may contain only letters, digits, dot, underscore and hyphen.'
});

const confirm = (ref) => Joi.any().valid(Joi.ref(ref)).required().messages({
  'any.only': 'Passwords do not match.', 'any.required': 'Confirm Password is required.'
});

// ---------- Auth ----------
const login = Joi.object({
  login: text('Username or Email', 254, { required: true }),
  password: Joi.string().max(P.maxLength).required().messages({ 'any.required': 'Password is required.', 'string.empty': 'Password is required.' })
});

const register = Joi.object({
  name: text('Full Name', L.nameMax, { required: true, min: 2 }),
  username,
  email: email('Email'),
  phone: phone('Phone', false),
  password: password(),
  confirmPassword: confirm('password')
});

const changePassword = Joi.object({
  currentPassword: Joi.string().required().messages({ 'any.required': 'Current Password is required.', 'string.empty': 'Current Password is required.' }),
  newPassword: password('New Password'),
  confirmPassword: confirm('newPassword')
});

// ---------- Users ----------
const userCreate = Joi.object({
  name: text('Full Name', L.nameMax, { required: true, min: 2 }),
  username,
  email: email('Email'),
  phone: phone('Phone', false),
  role: oneOf('Role', Object.values(C.ROLES)),
  managerId: objectId('Manager', false),
  isActive: Joi.boolean().default(true),
  password: password()
});
const userUpdate = Joi.object({
  name: text('Full Name', L.nameMax, { required: true, min: 2 }),
  email: email('Email'),
  phone: phone('Phone', false),
  role: oneOf('Role', Object.values(C.ROLES)),
  managerId: objectId('Manager', false)
});
const userStatus = Joi.object({ isActive: Joi.boolean().required().messages({ 'any.required': 'isActive is required.' }) });
const resetPassword = Joi.object({ newPassword: password('New Password'), confirmPassword: confirm('newPassword') });

const rolePermissions = Joi.object({
  permissions: Joi.array().items(Joi.string().valid(...C.ALL_PERMISSIONS)).required()
    .messages({ 'any.only': 'Unknown permission.', 'any.required': 'Permissions are required.' })
});

// ---------- Customers ----------
const customer = Joi.object({
  customerName: text('Customer Name', L.nameMax, { required: true, min: 2 }),
  email: email('Email'),
  phone: phone('Phone'),
  companyName: text('Company Name', L.companyMax),
  address: text('Address', L.addressMax),
  city: text('City', L.cityMax),
  state: text('State', L.cityMax),
  status: oneOf('Status', C.CUSTOMER_STATUSES),
  ownerId: objectId('Assigned Sales Executive', false),
  notes: text('Notes', L.notesMax)
});

// ---------- Leads ----------
const leadFields = {
  leadName: text('Lead Name', L.nameMax, { required: true, min: 2 }),
  email: email('Email', false),
  phone: phone('Phone', false),
  companyName: text('Company Name', L.companyMax),
  source: oneOf('Lead Source', C.LEAD_SOURCES),
  priority: oneOf('Priority', C.PRIORITIES),
  expectedValue: number('Expected Value', { min: 0, max: L.leadExpectedValueMax, required: false,
    minMessage: 'Expected Value cannot be negative.', maxMessage: `Expected Value must be between 0 and ${L.leadExpectedValueMax}.` }),
  assignedToId: objectId('Assigned Sales Executive', false),
  notes: text('Notes', L.notesMax)
};
const contactRequired = (schema) => schema.custom((v, h) => {
  if (!v.email && !v.phone) return h.message('Provide at least an email or a phone number for the lead.');
  return v;
});
const leadCreate = contactRequired(Joi.object({ ...leadFields, status: oneOf('Lead Status', C.LEAD_STATUSES.filter((s) => s !== 'Converted'), false) }));
const leadUpdate = contactRequired(Joi.object({ ...leadFields, status: oneOf('Lead Status', C.LEAD_STATUSES) }));
const leadStatus = Joi.object({ status: oneOf('Lead Status', C.LEAD_STATUSES), note: text('Note', 500) });
const leadAssign = Joi.object({ assignedToId: objectId('Assigned Sales Executive') });
const leadConvert = Joi.object({
  existingCustomerId: objectId('Existing Customer', false),
  customer: Joi.object({
    customerName: text('Customer Name', L.nameMax, { required: true, min: 2 }),
    email: email('Email'),
    phone: phone('Phone'),
    companyName: text('Company Name', L.companyMax),
    address: text('Address', L.addressMax),
    city: text('City', L.cityMax),
    state: text('State', L.cityMax)
  }).optional(),
  createOpportunity: Joi.boolean().default(false),
  opportunity: Joi.object({
    opportunityName: text('Opportunity Name', L.subjectMax, { required: true, min: 2 }),
    amount: number('Opportunity Amount', { required: true }),
    probability: number('Probability', { required: true }),
    expectedCloseDate: date('Expected Close Date')
  }).when('createOpportunity', { is: true, then: Joi.required(), otherwise: Joi.optional() })
}).custom((v, h) => (!v.existingCustomerId && !v.customer ? h.message('Customer details are required for conversion.') : v));

// ---------- Opportunities ----------
// Amount/probability/date business rules are re-checked in the service with
// the exact messages from section 5.4; Joi here guards type & format.
const opportunity = Joi.object({
  opportunityName: text('Opportunity Name', L.subjectMax, { required: true, min: 2 }),
  customerId: objectId('Customer'),
  leadId: objectId('Lead', false),
  amount: number('Opportunity Amount', { required: true }),
  probability: number('Probability', { required: false }),
  stage: oneOf('Stage', C.OPPORTUNITY_STAGES),
  expectedCloseDate: date('Expected Close Date'),
  source: oneOf('Source', C.LEAD_SOURCES, false),
  assignedToId: objectId('Owner', false),
  outcomeReason: text('Outcome Reason', 500),
  notes: text('Notes', L.notesMax)
});
const opportunityStage = Joi.object({
  stage: oneOf('Stage', C.OPPORTUNITY_STAGES),
  probability: number('Probability', { required: false }),
  outcomeReason: text('Outcome Reason', 500)
});

// ---------- Follow-ups ----------
const followUp = Joi.object({
  subject: text('Subject', L.subjectMax, { required: true, min: 2 }),
  followUpType: oneOf('Follow-Up Type', C.FOLLOWUP_TYPES),
  followUpDate: date('Follow-Up Date'),
  relatedType: oneOf('Related To', C.RELATED_TYPES),
  relatedId: objectId('Related Record'),
  assignedToId: objectId('Assigned User', false),
  remarks: text('Remarks', L.notesMax)
});
const followUpUpdate = Joi.object({
  subject: text('Subject', L.subjectMax, { required: true, min: 2 }),
  followUpType: oneOf('Follow-Up Type', C.FOLLOWUP_TYPES),
  followUpDate: date('Follow-Up Date'),
  assignedToId: objectId('Assigned User', false),
  remarks: text('Remarks', L.notesMax)
});
const followUpComplete = Joi.object({ outcome: text('Outcome', L.notesMax, { required: true, min: 2 }) });
const followUpReschedule = Joi.object({ followUpDate: date('New Follow-Up Date'), note: text('Reason', 500) });
const followUpNote = Joi.object({ note: text('Reason', 500) });

// ---------- Activities ----------
const activity = Joi.object({
  activityType: oneOf('Activity Type', C.ACTIVITY_TYPES),
  subject: text('Subject', L.subjectMax, { required: true, min: 2 }),
  description: text('Description', L.notesMax),
  activityDate: date('Activity Date'),
  status: oneOf('Status', C.ACTIVITY_STATUSES),
  customerId: objectId('Customer', false),
  leadId: objectId('Lead', false),
  opportunityId: objectId('Opportunity', false),
  assignedToId: objectId('Assigned User', false)
}).custom((v, h) => (!v.customerId && !v.leadId && !v.opportunityId
  ? h.message('Link the activity to a customer, lead or opportunity.') : v));

module.exports = {
  login, register, changePassword,
  userCreate, userUpdate, userStatus, resetPassword, rolePermissions,
  customer, leadCreate, leadUpdate, leadStatus, leadAssign, leadConvert,
  opportunity, opportunityStage,
  followUp, followUpUpdate, followUpComplete, followUpReschedule, followUpNote,
  activity
};
