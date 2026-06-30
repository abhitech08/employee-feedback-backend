const Joi = require('joi');

const validateCompany = (data) => {
  const schema = Joi.object({
    company_name: Joi.string().min(3).max(255).required()
  });
  return schema.validate(data, { abortEarly: false });
};

module.exports = {
  validateCompany
};
