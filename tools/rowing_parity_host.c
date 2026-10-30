/* Host replay of a lab CSV through rowing_metrics.
 * Build: gcc -DROWPOD_HOST -O2 -Icomponents/rowing_metrics/include \
 *   -o rowing_parity_host tools/rowing_parity_host.c \
 *   components/rowing_metrics/rowing_metrics.c -lm
 */
#include "rowing_metrics.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int col_of(char *header, const char *name)
{
    int idx = 0;
    char *save = NULL;
    for (char *tok = strtok_r(header, ",", &save); tok; tok = strtok_r(NULL, ",", &save), idx++) {
        if (strcmp(tok, name) == 0) {
            return idx;
        }
    }
    return -1;
}

static const char *field(char *line, int want, char *buf, size_t buflen)
{
    int idx = 0;
    char *save = NULL;
    buf[0] = '\0';
    for (char *tok = strtok_r(line, ",", &save); tok; tok = strtok_r(NULL, ",", &save), idx++) {
        if (idx == want) {
            snprintf(buf, buflen, "%s", tok);
            return buf;
        }
    }
    return NULL;
}

int main(int argc, char **argv)
{
    const char *path = argc > 1 ? argv[1] : "sample_capture/test1.csv";
    FILE *f = fopen(path, "r");
    if (!f) {
        perror(path);
        return 1;
    }
    char line[2048];
    int c_ms = -1, c_ax = -1, c_ay = -1, c_az = -1, c_gx = -1, c_gy = -1, c_gz = -1;
    rowing_metrics_init();
    rowing_metrics_zero();
    uint32_t n = 0;
    while (fgets(line, sizeof(line), f)) {
        if (line[0] == '#' || line[0] == '\n' || line[0] == '\r') {
            continue;
        }
        char *nl = strchr(line, '\n');
        if (nl) {
            *nl = '\0';
        }
        if (c_ms < 0) {
            char header[2048];
            snprintf(header, sizeof(header), "%s", line);
            c_ms = col_of(header, "synced_ms");
            snprintf(header, sizeof(header), "%s", line);
            c_ax = col_of(header, "ax_g");
            snprintf(header, sizeof(header), "%s", line);
            c_ay = col_of(header, "ay_g");
            snprintf(header, sizeof(header), "%s", line);
            c_az = col_of(header, "az_g");
            snprintf(header, sizeof(header), "%s", line);
            c_gx = col_of(header, "gx_dps");
            snprintf(header, sizeof(header), "%s", line);
            c_gy = col_of(header, "gy_dps");
            snprintf(header, sizeof(header), "%s", line);
            c_gz = col_of(header, "gz_dps");
            if (c_ms < 0 || c_ax < 0 || c_gx < 0) {
                fprintf(stderr, "missing columns\n");
                return 1;
            }
            continue;
        }
        char copy[2048];
        char b_ms[64], b_ax[64], b_ay[64], b_az[64], b_gx[64], b_gy[64], b_gz[64];
        snprintf(copy, sizeof(copy), "%s", line);
        if (!field(copy, c_ms, b_ms, sizeof(b_ms))) {
            continue;
        }
        snprintf(copy, sizeof(copy), "%s", line);
        if (!field(copy, c_ax, b_ax, sizeof(b_ax))) {
            continue;
        }
        snprintf(copy, sizeof(copy), "%s", line);
        if (!field(copy, c_ay, b_ay, sizeof(b_ay))) {
            continue;
        }
        snprintf(copy, sizeof(copy), "%s", line);
        if (!field(copy, c_az, b_az, sizeof(b_az))) {
            continue;
        }
        snprintf(copy, sizeof(copy), "%s", line);
        if (!field(copy, c_gx, b_gx, sizeof(b_gx))) {
            continue;
        }
        snprintf(copy, sizeof(copy), "%s", line);
        if (!field(copy, c_gy, b_gy, sizeof(b_gy))) {
            continue;
        }
        snprintf(copy, sizeof(copy), "%s", line);
        if (!field(copy, c_gz, b_gz, sizeof(b_gz))) {
            continue;
        }
        rowing_stroke_t stroke;
        uint32_t t_ms = (uint32_t)strtod(b_ms, NULL);
        if (rowing_metrics_push(n, (float)strtod(b_ax, NULL), (float)strtod(b_ay, NULL),
                                (float)strtod(b_az, NULL), (float)strtod(b_gx, NULL),
                                (float)strtod(b_gy, NULL), (float)strtod(b_gz, NULL),
                                t_ms, &stroke)) {
            printf("F %.3f %.3f %.3f %.3f\n", stroke.catch_deg, stroke.finish_deg,
                   stroke.arc_deg, (double)t_ms);
        }
        n++;
    }
    fclose(f);
    fprintf(stderr, "samples %u\n", (unsigned)n);
    return 0;
}
