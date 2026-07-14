# -*- coding: utf-8 -*-
"""בדיקות לפרסר פורמט WhatsApp. הרצה: python3 -m unittest"""
import unittest
from datetime import date

import parser as p

REF = date(2026, 7, 14)

FULL = """[08/07/2026, 14:39:20] רונן פירמן יפתח: *בקשת ייצור*

פרויקט:
* MBaz (רשום תחת שועל מעופף)
נושא הייצור:
* חיתוך וכיפוף פלטות אלומיניום לייצור מסיט תרמילים לMBaz

כמות:
* 2
מכניס עבודה:
* גיא דהאן

בקר מאשר:
* רונן פירמן
* תאריך אישור: 6.7.26

מיקום ייצור:
* מסגריה / דגמים

תג”ב נדרש:
* 8.7.26

שם ייצור במערכת:
* מסיט תרמילים MBaz
* #1114

הערות מיוחדות:
* אין"""

TRUNCATED = """*בקשת ייצור*
פרויקט:
* צרצר
נושא הייצור:
* ג׳יג חתיכה לריטיינר 2
כמות:
* חלק בודד
מכניס עבודה:
* עידו מרון
בקר מאשר:
* רונן פירמן
* תאריך אישור: 12.07.26
מיקום ייצור:
* במדפסת fortus
תג”ב נדרש:
* 15.07.26"""


class TestParser(unittest.TestCase):
    def test_full_message(self):
        f = p.parse_request(FULL, ref=REF)
        self.assertEqual(f["project"], "MBaz")
        self.assertEqual(f["project_alias"], "שועל מעופף")  # B2
        self.assertEqual(f["quantity"], "2")
        self.assertEqual(f["requester"], "גיא דהאן")
        self.assertEqual(f["approver"], "רונן פירמן")
        self.assertEqual(f["approval_date"], "2026-07-06")
        self.assertEqual(f["due_date"], "2026-07-08")
        self.assertEqual(f["external_id"], "1114")  # B8
        self.assertEqual(f["system_name"], "מסיט תרמילים MBaz")
        self.assertEqual(f["notes"], "אין")
        self.assertEqual(f["missing"], [])
        self.assertEqual(p.intake_status(f), "מאושרת")

    def test_truncated_message_flags_missing(self):
        """B9: הודעה חתוכה נקלטת עם רשימת חוסרים במקום להידחות."""
        f = p.parse_request(TRUNCATED, ref=REF)
        self.assertEqual(f["quantity"], "חלק בודד")  # B1: כמות לא מספרית
        self.assertEqual(f["due_date"], "2026-07-15")
        self.assertEqual(f["missing"], ["שם ייצור במערכת"])
        self.assertEqual(p.intake_status(f), "מעוכבת")

    def test_no_approval_is_awaiting(self):
        """B5: בקשה עם בקר אך ללא תאריך אישור — ממתינה לאישור."""
        f = p.parse_request(TRUNCATED.replace("* תאריך אישור: 12.07.26", ""), ref=REF)
        f["system_name"] = "משהו"
        f["missing"] = p.missing_fields(f)
        self.assertEqual(p.intake_status(f), "ממתינה לאישור")

    def test_date_formats(self):
        """B7: פורמטי תאריך מעורבים."""
        self.assertEqual(p.normalize_date("22.6", ref=REF), "2026-06-22")
        self.assertEqual(p.normalize_date("15.07.26", ref=REF), "2026-07-15")
        self.assertEqual(p.normalize_date("8/7/2026", ref=REF), "2026-07-08")
        self.assertIsNone(p.normalize_date("מחר", ref=REF))
        self.assertIsNone(p.normalize_date("32.13", ref=REF))

    def test_quote_variants_in_tagab(self):
        """תג”ב / תג\"ב / תג״ב — כולם מזוהים."""
        for quote in ('"', "”", "״"):
            text = "תג%sב נדרש:\n* 20.7.26" % quote
            self.assertEqual(p.parse_request(text, ref=REF).get("due_date"), "2026-07-20",
                             "נכשל עבור גרש: %r" % quote)

    def test_whatsapp_header_stripped(self):
        f = p.parse_request(FULL, ref=REF)
        self.assertNotIn("רונן פירמן יפתח:", f.get("project", ""))

    def test_roundtrip_to_whatsapp(self):
        """ייצוא חזרה ל-WhatsApp ופירוק מחדש משמר את השדות."""
        f = p.parse_request(FULL, ref=REF)
        again = p.parse_request(p.to_whatsapp(f), ref=REF)
        for key in ("project", "project_alias", "subject", "quantity", "requester",
                    "approver", "approval_date", "location", "due_date",
                    "system_name", "external_id"):
            self.assertEqual(again.get(key), f.get(key), key)

    def test_ein_cleared_outside_notes(self):
        f = p.parse_request("מיקום ייצור:\n* אין\nהערות מיוחדות:\n* אין", ref=REF)
        self.assertEqual(f.get("location", ""), "")
        self.assertEqual(f["notes"], "אין")


if __name__ == "__main__":
    unittest.main()
