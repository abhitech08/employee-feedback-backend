const Joi = require('joi');

const validateEmployee = (data) => {
  const schema = Joi.object({
    employee_id: Joi.string().max(50).required(),
    name: Joi.string().min(2).max(255).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/).optional(),
    mobile: Joi.string().max(20).allow('', null),
    designation: Joi.string().max(100).allow('', null),
    company_id: Joi.number().integer().required(),
    department_id: Joi.number().integer().required(),
    role: Joi.string().valid('super_admin', 'company_admin', 'employee').default('employee'),
    status: Joi.string().valid('active', 'inactive').default('active')
  });

  return schema.validate(data, { abortEarly: false });
};

module.exports = { validateEmployee };