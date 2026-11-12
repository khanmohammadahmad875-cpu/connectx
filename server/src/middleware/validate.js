// Zod validation helper: validate(schema) checks req.body against the schema
// and answers 400 with a readable message when input is wrong.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const first = result.error.issues[0];
      return res.status(400).json({
        message: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid input',
      });
    }
    req.body = result.data;
    return next();
  };
}

module.exports = { validate };
