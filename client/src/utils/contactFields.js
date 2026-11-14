// Contact-card field metadata (module 28), shared by the profile editor and
// the read-only contact-card view. Order here is the display order.
export const CONTACT_FIELD_META = [
  { key: 'phone', label: 'Phone', input: 'tel', placeholder: '+92 300 1234567' },
  { key: 'whatsappNumber', label: 'WhatsApp number', input: 'tel', placeholder: '+92 300 1234567' },
  { key: 'jobTitle', label: 'Job title', input: 'text', placeholder: 'Software engineer' },
  { key: 'organization', label: 'Organization', input: 'text', placeholder: 'Company / university' },
  { key: 'country', label: 'Country', input: 'text', placeholder: 'Pakistan' },
  { key: 'city', label: 'City', input: 'text', placeholder: 'Peshawar' },
  { key: 'homeAddress', label: 'Home address', input: 'text', placeholder: 'House, street, area' },
  { key: 'businessAddress', label: 'Business address', input: 'text', placeholder: 'Office address' },
  { key: 'postalCode', label: 'Postal code', input: 'text', placeholder: '25000' },
  { key: 'website', label: 'Website', input: 'url', placeholder: 'https://example.com' },
  { key: 'linkedin', label: 'LinkedIn', input: 'url', placeholder: 'https://linkedin.com/in/…' },
  { key: 'github', label: 'GitHub', input: 'url', placeholder: 'https://github.com/…' },
];

export const VISIBILITY_OPTIONS = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'My contacts' },
  { value: 'nobody', label: 'Only me' },
];

// A home address can never be public — the API enforces this too.
export function visibilityOptionsFor(fieldKey) {
  if (fieldKey === 'homeAddress') {
    return VISIBILITY_OPTIONS.filter((o) => o.value !== 'everyone');
  }
  return VISIBILITY_OPTIONS;
}

export function digitsOnly(value) {
  return (value || '').replace(/\D/g, '');
}
