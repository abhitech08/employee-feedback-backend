const Joi = require('joi');

const validateDepartment = (data) => {
  const schema = Joi.object({
    company_id: Joi.number().integer().required(),
    department_name: Joi.string().min(2).max(255).required(),
    status: Joi.string().valid('active', 'inactive')
  });
  return schema.validate(data, { abortEarly: false });
};

module.exports = {
  validateDepartment
};
