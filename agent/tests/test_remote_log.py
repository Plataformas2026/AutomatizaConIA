import logging
import unittest

import remote_log


def make(clock):
    h = remote_log.RemoteLogHandler(clock=clock)
    lg = logging.Logger("t")
    lg.setLevel(logging.DEBUG)
    lg.addHandler(h)
    return h, lg


class RemoteLogTests(unittest.TestCase):
    def test_only_warnings_errors_and_marked_events(self):
        h, lg = make(lambda: 1000.0)
        lg.info("ruido")
        lg.debug("más ruido")
        lg.warning("aviso")
        lg.error("fallo")
        lg.info("Agente en marcha", extra={"remote": True})
        got = []
        h.flush_to(got.extend)
        self.assertEqual([(e["level"], e["message"]) for e in got],
                         [("warning", "aviso"), ("error", "fallo"), ("info", "Agente en marcha")])
        self.assertEqual(h.pending(), 0)

    def test_emails_are_redacted_and_text_trimmed(self):
        h, lg = make(lambda: 1.0)
        lg.warning("No se pudo entregar a marta.ruiz+x@empresa.es: %s", "x" * 900)
        got = []
        h.flush_to(got.extend)
        self.assertNotIn("@", got[0]["message"])
        self.assertIn("[correo]", got[0]["message"])
        self.assertLessEqual(len(got[0]["message"]), 500)

    def test_repeats_are_grouped_and_age_computed(self):
        t = [100.0]
        h, lg = make(lambda: t[0])
        for _ in range(4):
            lg.warning("Sin conexión")
        t[0] = 160.0
        got = []
        h.flush_to(got.extend)
        self.assertEqual(len(got), 1)
        self.assertEqual((got[0]["n"], got[0]["age"]), (4, 60))

    def test_failed_send_keeps_queue(self):
        h, lg = make(lambda: 1.0)
        lg.error("a")

        def boom(_):
            raise RuntimeError("sin red")

        with self.assertRaises(RuntimeError):
            h.flush_to(boom)
        self.assertEqual(h.pending(), 1)
        got = []
        h.flush_to(got.extend)
        self.assertEqual(len(got), 1)

    def test_queue_is_bounded_and_batched(self):
        h, lg = make(lambda: 1.0)
        for i in range(300):
            lg.warning("mensaje %d", i)
        self.assertEqual(h.pending(), remote_log.MAX_PENDING)
        got = []
        self.assertEqual(h.flush_to(got.extend), remote_log.BATCH)
        self.assertEqual(h.pending(), remote_log.MAX_PENDING - remote_log.BATCH)
        self.assertEqual(got[0]["message"], "mensaje 100")  # se descartaron los más antiguos


if __name__ == "__main__":
    unittest.main()


class FlushLogsTests(unittest.TestCase):
    def _agent(self, report):
        import agent as ag
        a = object.__new__(ag.Agent)
        a.api = type("A", (), {"report_logs": staticmethod(report)})()
        a.remote_log, a._next_logs, a._logs_blocked_until = remote_log.RemoteLogHandler(), 0.0, 0.0
        lg = logging.Logger("x")
        lg.addHandler(a.remote_log)
        return ag, a, lg

    def test_sends_and_survives_network_errors(self):
        sent = []
        ag, a, lg = self._agent(lambda e: sent.extend(e) or len(e))
        lg.warning("uno")
        a.flush_logs(force=True)
        self.assertEqual([e["message"] for e in sent], ["uno"])
        ag2, b, lg2 = self._agent(lambda e: (_ for _ in ()).throw(ag.ApiUnavailable("x")))
        lg2.error("dos")
        b.flush_logs(force=True)  # no lanza
        self.assertEqual(b.remote_log.pending(), 1)

    def test_api_error_backs_off(self):
        calls = []

        def fail(e):
            calls.append(1)
            raise __import__("api").ApiError("Faltan migraciones")

        _, a, lg = self._agent(fail)
        lg.error("x")
        a.flush_logs(force=True)
        a.flush_logs()  # bloqueado 10 min: no insiste
        self.assertEqual(len(calls), 1)
