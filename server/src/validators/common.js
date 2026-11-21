const Joi = require('joi');
const config = require('../config');

const L = config.limits;

/** Field-specific required/length messages, e.g. "Customer Name is required." */
const text = (label, max, { required = false, min = 0 } = {}) => {
  let s = Joi.string().trim().max(max);
  if (min) s = s.min(min);
  s = required ? s.required() : s.allow('', null);
  return s.label(label).messages({
    'any.required': `${label} is required.`,
    'string.empty': `${label} is required.`,
    'string.base': `${label} must be text.`,
    'string.max': `${label} cannot exceed ${max} characters.`,
    'string.min': `${label} must be at least ${min} characters.`
  });
};

const email = (label = 'Email', required = true) => {
  let s = Joi.string().trim().lowercase().max(L.emailMax).email({ tlds: { allow: false } });
  s = required ? s.required() : s.allow('', null);
  return s.messages({
    'any.required': `${label} is required.`,
    'string.empty': `${label} is required.`,
    'string.email': 'Enter a valid email address.',
    'string.max': `${label} cannot exceed ${L.emailMax} characters.`
  });
};

const phone = (label = 'Phone', required = true) => {
  let s = Joi.string().trim().pattern(config.phonePattern);
  s = required ? s.required() : s.allow('', null);
  return s.messages({
    'any.required': `${label} is required.`,
    'string.empty': `${label} is required.`,
    'string.pattern.base': 'Enter a valid phone number.'
  });
};

const oneOf = (label, values, required = true) => {
  let s = Joi.string().valid(...values);
  s = required ? s.required() : s.allow('', null);
  return s.messages({
    'any.required': `${label} is required.`,
    'string.empty': `${label} is required.`,
    'any.only': `${label} must be one of: ${values.join(', ')}.`
  });
};

const objectId = (label, required = true) => {
  let s = Joi.string().pattern(/^[a-f\d]{24}$/i);
  s = required ? s.required() : s.allow('', null);
  return s.messages({
    'any.required': `${label} is required.`,
    'string.empty': `${label} is required.`,
    'string.pattern.base': `${label} is not a valid reference.`
  });
};

const date = (label, required = true) => {
  let s = Joi.date().iso();
  s = required ? s.required() : s.allow('', null);
  return s.messages({
    'any.required': `${label} is required.`,
    'date.base': `${label} must be a valid date.`,
    'date.format': `${label} must be a valid date.`
  });
};

const number = (label, { min, max, required = true, integer = false, minMessage, maxMessage } = {}) => {
  let s = Joi.number();
  if (integer) s = s.integer();
  if (min !== undefined) s = s.min(min);
  if (max !== undefined) s = s.max(max);
  s = required ? s.required() : s.allow(null, '');
  return s.messages({
    'any.required': `${label} is required.`,
    'number.base': `${label} must be a number.`,
    'number.integer': `${label} must be a whole number.`,
    'number.min': minMessage || `${label} must be at least ${min}.`,
    'number.max': maxMessage || `${label} cannot exceed ${max}.`
  });
};

module.exports = { Joi, text, email, phone, oneOf, objectId, date, number, L };
