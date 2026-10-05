import { describe, expect, it } from 'vitest';
import { parseIdText } from './kyc-id-text.js';
import type { DocumentText } from './document-intelligence-port.js';

export function licenceText(content: string, confidence = 0.94): DocumentText {
  let offset = 0;
  const lines = content.split('\n').map((value) => {
    const line = { offset, length: value.length, page: 1, polygon: [] };
    offset += value.length + 1;
    return line;
  });
  return { content, lines, words: lines.filter((line) => line.length).map((line) => ({ offset: line.offset, length: line.length, confidence })) };
}

describe('licence label text', () => {
  it.each([
    ['DELA CRUZ, JUAN SANTOS', 'JUAN', 'SANTOS', 'DELA CRUZ'],
    ['SAN JUAN, JUAN CARLO REYES', 'JUAN CARLO', 'REYES', 'SAN JUAN'],
    ['PEÑA, ANA', 'ANA', '', 'PEÑA'],
    [' | DELA   CRUZ,   JUAN   CARLO SANTOS | ', 'JUAN CARLO', 'SANTOS', 'DELA CRUZ'],
  ])('splits %s at the comma and final token', (value, first, middle, last) => {
    const fields = parseIdText('drivers_license', licenceText(`Last Name, First Name, Middle Name\n\n${value}\nSex\nM`));
    expect(fields).toMatchObject({ first_name: { value: first }, middle_name: { value: middle }, last_name: { value: last } });
    expect(fields.first_name?.confidence).toBe(0.94);
  });
  it.each(['LASTNAME FIRSTNAME MIDDLENAME', 'Last Nane, First Name, Middle Name', 'Last Name First Name Middle Name:'])('tolerates label spacing/noise: %s', (label) => {
    expect(parseIdText('drivers_license', licenceText(`${label}\nPEÑA, ANA MARIA REYES`)).first_name?.value).toBe('ANA MARIA');
  });
  it('does not guess a name without its comma or label', () => {
    expect(parseIdText('drivers_license', licenceText('Last Name First Name Middle Name\nDELA CRUZ JUAN SANTOS'))).toEqual({});
    expect(parseIdText('drivers_license', licenceText('DELA CRUZ, JUAN SANTOS'))).toEqual({});
  });
  it.each(['License No.', 'Expiration Date', 'Agency Code', 'Blood Type', 'Eyes Color', 'Conditions', 'Weight', 'Height', 'Sex', 'Date of Birth', 'Nationality'])('stops a multiline address at %s', (label) => {
    const fields = parseIdText('drivers_license', licenceText(`Address\n12 SAMPLE STREET\nBARANGAY UNO\nQUEZON CITY\n${label}\nOTHER VALUE`));
    expect(fields.address).toEqual({ value: '12 SAMPLE STREET, BARANGAY UNO, QUEZON CITY', confidence: 0.94 });
  });
  it('leaves missing or empty addresses to query-field fallback', () => {
    expect(parseIdText('drivers_license', licenceText('12 SAMPLE STREET\nQUEZON CITY'))).toEqual({});
    expect(parseIdText('drivers_license', licenceText('Address\nLicense No.\nN01-23-456789'))).toEqual({});
  });
  it('never manufactures word confidence', () => {
    const text = licenceText('Last Name First Name Middle Name\nPEÑA, ANA REYES');
    text.words = [];
    expect(parseIdText('drivers_license', text).first_name?.confidence).toBe(0);
  });
  it.each(['philsys', 'passport', 'umid', 'sss'] as const)('leaves %s unchanged', (type) => {
    expect(parseIdText(type, licenceText('Last Name First Name Middle Name\nPEÑA, ANA REYES\nAddress\n12 SAMPLE STREET'))).toEqual({});
  });
});
