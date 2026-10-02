/**
 * Fixture pair for Phase 7 Document Comparison tests.
 * Contains:
 * 1. AED 100,000 -> AED 1,000,000 (modified clause, amount changed >= 2x => HIGH significance)
 * 2. Pure rewording (modified clause, same meaning, no material token changes => LOW/COSMETIC)
 * 3. Moved clause (identical text moved to a different position => MOVED, not added+removed)
 * 4. Added clause (only in Contract B => ADDED)
 * 5. Removed clause (only in Contract A => REMOVED)
 * 6. Unchanged clauses (Preamble, Payment Terms, Governing Law => UNCHANGED)
 */

export const CONTRACT_A = `1. Preamble
This Master Services Agreement is entered into by and between Alpha Corp and Beta LLC.

2. Scope of Services
Provider shall perform the software development and consulting services described in each Statement of Work.

3. Payment Terms
Customer shall pay all undisputed invoices within 30 days of receipt. Late payments shall accrue interest at 1.5% per month.

4. Confidentiality
Each party agrees to maintain the confidentiality of all proprietary information disclosed by the other party.

5. Limitation of Liability
The total aggregate liability of either party arising out of or related to this Agreement shall not exceed AED 100,000.

6. Dispute Resolution
Any dispute arising from this Agreement shall be resolved through binding arbitration in the Dubai International Financial Centre.

7. Term and Termination
Either party may terminate this Agreement for convenience upon 60 days prior written notice.

8. Governing Law
This Agreement shall be governed by and construed in accordance with the laws of the United Arab Emirates.`;

export const CONTRACT_B = `1. Preamble
This Master Services Agreement is entered into by and between Alpha Corp and Beta LLC.

2. Scope of Services
Provider will deliver the software engineering and advisory services detailed in each Statement of Work.

3. Dispute Resolution
Any dispute arising from this Agreement shall be resolved through binding arbitration in the Dubai International Financial Centre.

4. Payment Terms
Customer shall pay all undisputed invoices within 30 days of receipt. Late payments shall accrue interest at 1.5% per month.

5. Limitation of Liability
The total aggregate liability of either party arising out of or related to this Agreement shall not exceed AED 1,000,000.

6. Term and Termination
Either party may terminate this Agreement for convenience upon 60 days prior written notice.

7. Data Protection and Security
Provider shall implement and maintain industry-standard administrative, physical, and technical safeguards to protect Customer Data.

8. Governing Law
This Agreement shall be governed by and construed in accordance with the laws of the United Arab Emirates.`;
