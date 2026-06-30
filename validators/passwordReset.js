const Joi = require('joi');

const validateForgotPassword = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required()
  });

  return schema.validate(data, { abortEarly: false });
};

const validateResetPassword = (data) => {
  const schema = Joi.object({
    token: Joi.string().required(),
    newPassword: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).required()
  });

  return schema.validate(data, { abortEarly: false });
};

module.exports = { validateForgotPassword, validateResetPassword };