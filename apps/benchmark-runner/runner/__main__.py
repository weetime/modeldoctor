"""Allow ``python -m runner`` to invoke the runner entrypoint."""

import sys

from runner.main import main

sys.exit(main())
