// The sign-up form's state and functions (signup.html).
const errors = {
  name: (v) => (!v.trim() ? 'Enter your name.' : v.trim().length < 3 ? 'That name is too short.' : ''),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Enter a valid email.'),
  password: (v) => (v.length < 8 ? 'Use at least 8 characters.' : ''),
  age: (v) => (v === '' ? 'Enter your age.' : v < 18 ? 'You must be 18 or older.' : ''),
}
const confirmError = (f) => (f.confirm !== f.password ? 'The passwords do not match.' : '')
const taxIdError = (f) => (f.plan === 'business' && f.taxId.replace(/\D/g, '').length !== 9 ? 'An EIN has 9 digits.' : '')
const blank = () => ({ name: '', email: '', password: '', confirm: '', age: '', country: '', plan: 'free', taxId: '', interests: [], languages: [], frequency: 1, bio: '', terms: false })

export const state = () => ({
  title: 'Sign up · core-query',
  options: {
    countries: [{ code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' }, { code: 'CA', name: 'Canada' }, { code: 'BR', name: 'Brazil' }, { code: 'PT', name: 'Portugal' }],
    plans: [{ id: 'free', name: 'Free', price: '$0' }, { id: 'pro', name: 'Pro', price: '$29/month' }, { id: 'business', name: 'Business', price: '$99/month' }],
    interests: ['Front-end', 'Back-end', 'Design', 'Data', 'DevOps'],
    languages: ['English', 'Spanish', 'Portuguese', 'French'],
  },
  form: blank(),
  sent: null,
})

export const fns = {
  json: (v) => JSON.stringify(v, null, 2),
  nameError: errors.name,
  emailError: errors.email,
  passwordError: errors.password,
  ageError: errors.age,
  confirmError,
  taxIdError,
  invalid: (f) => Object.keys(errors).some((k) => errors[k](f[k])) || !!confirmError(f) || !!taxIdError(f) || f.bio.length > 160 || !f.terms,
  strength: (s) => [/.{8}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length * 25 + '%',
  frequency: (n) => (n ? (n === 7 ? 'Every day.' : `${n} a week.`) : 'None.'),
  left: (bio, max) => `${max - bio.length} characters left`,
  over: (bio, max) => bio.length > max,
  blank,
  // What goes to the server: no password confirmation, and a tax ID only for the business plan.
  payload: (_, { confirm, ...data }) => {
    if (data.plan !== 'business') delete data.taxId
    return data
  },
}
