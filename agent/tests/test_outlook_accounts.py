import sys
import types
import unittest
from unittest import mock

import outlook


class Folder:
    def __init__(self, store): self.StoreID = store; self.saved = []; self.Items = self
    def Add(self, kind): m = Mail(self); self.saved.append(m); return m


class Mail:
    def __init__(self, parent=None): self.Parent = parent or Folder("default"); self.log = []
    def Save(self): self.log.append("save")
    def Send(self): self.log.append("send")
    def Display(self): self.log.append("display")


class Acc:
    def __init__(self, addr, folder): self.SmtpAddress = addr; self.DeliveryStore = types.SimpleNamespace(GetDefaultFolder=lambda n: folder)


class App:
    def __init__(self):
        self.f_a, self.f_b = Folder("A"), Folder("B")
        self.Session = types.SimpleNamespace(Accounts=[Acc("a@x.com", self.f_a), Acc("b@y.com", self.f_b)], Stores=[])
        self.created = []
    def CreateItem(self, k): m = Mail(); self.created.append(m); return m


def sender_with(app, default=""):
    s = outlook.OutlookSender(default)
    s._app = app
    return s


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.p = mock.patch.object(sys, "platform", "win32"); self.p.start()
    def tearDown(self): self.p.stop()

    def test_draft_goes_to_configured_account_folder(self):
        app = App()
        sender_with(app, "b@y.com").deliver(to=["z@z.com"], subject="s", body="b", sender=None, draft=True)
        self.assertEqual((len(app.f_b.saved), len(app.f_a.saved), app.created), (1, 0, []))
        self.assertEqual(app.f_b.saved[0].SendUsingAccount.SmtpAddress, "b@y.com")
        self.assertEqual(app.f_b.saved[0].log, ["save"])

    def test_rule_sender_wins_over_default(self):
        app = App()
        sender_with(app, "b@y.com").deliver(to=["z@z.com"], subject="s", body="b", sender="A@x.com", draft=True)
        self.assertEqual(len(app.f_a.saved), 1)

    def test_unknown_account_is_rejected(self):
        with self.assertRaises(outlook.OutlookRejected):
            sender_with(App(), "nope@x.com").deliver(to=["z@z.com"], subject="s", body="b", sender=None, draft=True)

    def test_no_account_uses_default_mailbox(self):
        app = App()
        sender_with(app).deliver(to=["z@z.com"], subject="s", body="b", sender=None, draft=True)
        self.assertEqual(len(app.created), 1)

    def test_send_uses_account(self):
        app = App()
        sender_with(app, "b@y.com").deliver(to=["z@z.com"], subject="s", body="b", sender=None, draft=False)
        self.assertEqual(app.created[0].log, ["send"])
        self.assertEqual(app.created[0].SendUsingAccount.SmtpAddress, "b@y.com")

    def test_cc_and_list(self):
        app = App()
        s = sender_with(app, "a@x.com")
        s.deliver(to=["z@z.com"], cc=["c@c.com", "d@d.com"], subject="s", body="b", sender=None, draft=True)
        self.assertEqual(app.f_a.saved[0].CC, "c@c.com; d@d.com")
        s.deliver(to=["z@z.com"], subject="s", body="b", sender=None, draft=True)
        self.assertFalse(hasattr(app.f_a.saved[1], "CC"))
        self.assertEqual(s.list_accounts(), ["a@x.com", "b@y.com"])


if __name__ == "__main__":
    unittest.main()
