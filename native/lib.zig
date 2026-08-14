const std = @import("std");
const builtin = @import("builtin");
const zigtex = @import("zigtex");

const c = @cImport({
    @cInclude("nanosvg.h");
    @cInclude("nanosvgrast.h");
});

const source_size_max = 4096;
const dimension_max = 4096;
const supersample = 4;
const channels = 4;

const Status = enum(u32) {
    ok = 0,
    invalid_argument = 1,
    invalid_tex = 2,
    invalid_svg = 3,
    invalid_dimensions = 4,
    out_of_memory = 5,
    internal_error = 6,
};

const RenderResult = struct {
    pixels: []u8 = &.{},
    width: u32 = 0,
    height: u32 = 0,
    status: Status = .ok,
};

var renderer_instance: ?zigtex.TexSvgRender = null;
var test_fail_after_pixel_allocation = false;
var test_pixel_allocations: usize = 0;

export fn texInit() u32 {
    if (renderer_instance != null) return @intFromEnum(Status.ok);
    renderer_instance = zigtex.TexSvgRender.init(std.heap.c_allocator, .{}) catch |err| {
        return @intFromEnum(statusFromError(err));
    };
    return @intFromEnum(Status.ok);
}

export fn texRender(
    source_ptr: ?[*]const u8,
    source_length: u32,
    display_value: u8,
    foreground_ptr: ?[*]const u8,
    background_ptr: ?[*]const u8,
) ?*RenderResult {
    const result = std.heap.c_allocator.create(RenderResult) catch return null;
    result.* = .{};

    if (source_ptr == null or source_length == 0 or source_length > source_size_max) {
        result.status = .invalid_argument;
        return result;
    }
    if (foreground_ptr == null or background_ptr == null) {
        result.status = .invalid_argument;
        return result;
    }

    const source = source_ptr.?[0..source_length];
    const foreground = foreground_ptr.?[0..3].*;
    const background = background_ptr.?[0..3].*;

    if (renderer_instance == null) {
        result.status = .internal_error;
        return result;
    }
    if (display_value > 1) {
        result.status = .invalid_argument;
        return result;
    }
    render(result, source, display_value == 1, foreground, background) catch |err| {
        result.status = statusFromError(err);
    };
    return result;
}

export fn texResultStatus(result: ?*const RenderResult) u32 {
    return if (result) |value| @intFromEnum(value.status) else @intFromEnum(Status.invalid_argument);
}

export fn texResultPixels(result: ?*const RenderResult) ?[*]const u8 {
    const value = result orelse return null;
    return if (value.pixels.len == 0) null else value.pixels.ptr;
}

export fn texResultPixelsLength(result: ?*const RenderResult) u32 {
    const value = result orelse return 0;
    const pixel_count = std.math.mul(u32, value.width, value.height) catch return 0;
    return std.math.mul(u32, pixel_count, channels) catch 0;
}

export fn texResultWidth(result: ?*const RenderResult) u32 {
    return if (result) |value| value.width else 0;
}

export fn texResultHeight(result: ?*const RenderResult) u32 {
    return if (result) |value| value.height else 0;
}

export fn texResultDestroy(result: ?*RenderResult) void {
    const value = result orelse return;
    freeResultPixels(value.pixels);
    std.heap.c_allocator.destroy(value);
}

fn render(
    result: *RenderResult,
    source: []const u8,
    display: bool,
    foreground: [3]u8,
    background: [3]u8,
) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.c_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var foreground_buffer: [7]u8 = undefined;
    const foreground_css = try std.fmt.bufPrint(
        &foreground_buffer,
        "#{x:0>2}{x:0>2}{x:0>2}",
        .{ foreground[0], foreground[1], foreground[2] },
    );
    const renderer = &(renderer_instance orelse return error.InternalError);
    const svg = renderer.parseRender(allocator, source, .{
        .size = 28,
        .spacing = 8,
        .style = if (display) .display else .in_line,
        .x_pad = 3,
        .y_pad = 3,
        .default_color = foreground_css,
    }) catch return error.InvalidTex;

    const mutable_svg = try svgWithoutDescription(allocator, svg);
    const image = c.nsvgParse(mutable_svg.ptr, "px", 96) orelse return error.InvalidSvg;
    defer c.nsvgDelete(image);
    const width: usize = @intFromFloat(@ceil(image.*.width * supersample));
    const height: usize = @intFromFloat(@ceil(image.*.height * supersample));
    if (width == 0 or height == 0 or width > dimension_max or height > dimension_max) {
        return error.InvalidDimensions;
    }
    const pixel_length = std.math.mul(usize, width, height) catch return error.InvalidDimensions;
    const pixels_length = std.math.mul(usize, pixel_length, channels) catch return error.InvalidDimensions;
    if (pixels_length > std.math.maxInt(u32)) return error.InvalidDimensions;
    const pixels = try allocResultPixels(pixels_length);
    errdefer freeResultPixels(pixels);
    if (builtin.is_test and test_fail_after_pixel_allocation) return error.OutOfMemory;
    const rasterizer = c.nsvgCreateRasterizer() orelse return error.OutOfMemory;
    defer c.nsvgDeleteRasterizer(rasterizer);
    c.nsvgRasterize(
        rasterizer,
        image,
        0,
        0,
        supersample,
        pixels.ptr,
        @intCast(width),
        @intCast(height),
        @intCast(width * channels),
    );
    compositeBackground(pixels, background);

    result.pixels = pixels;
    result.width = @intCast(width);
    result.height = @intCast(height);
}

fn allocResultPixels(length: usize) ![]u8 {
    const pixels = try std.heap.c_allocator.alloc(u8, length);
    if (builtin.is_test) test_pixel_allocations += 1;
    return pixels;
}

fn freeResultPixels(pixels: []u8) void {
    if (pixels.len == 0) return;
    std.heap.c_allocator.free(pixels);
    if (builtin.is_test) {
        std.debug.assert(test_pixel_allocations > 0);
        test_pixel_allocations -= 1;
    }
}

fn statusFromError(err: anyerror) Status {
    return switch (err) {
        error.InvalidTex => .invalid_tex,
        error.InvalidSvg => .invalid_svg,
        error.InvalidDimensions => .invalid_dimensions,
        error.OutOfMemory => .out_of_memory,
        else => .internal_error,
    };
}

fn compositeBackground(pixels: []u8, background: [3]u8) void {
    var offset: usize = 0;
    while (offset < pixels.len) : (offset += channels) {
        const alpha: u16 = pixels[offset + 3];
        const inverse = 255 - alpha;
        inline for (0..3) |channel| {
            pixels[offset + channel] = @intCast(
                (@as(u16, pixels[offset + channel]) * alpha +
                    @as(u16, background[channel]) * inverse + 127) / 255,
            );
        }
        pixels[offset + 3] = 255;
    }
}

fn svgWithoutDescription(allocator: std.mem.Allocator, svg: []const u8) ![:0]u8 {
    const start = std.mem.indexOf(u8, svg, "<desc>") orelse return allocator.dupeZ(u8, svg);
    const close = std.mem.lastIndexOf(u8, svg, "</desc>") orelse return error.InvalidSvg;
    if (close < start) return error.InvalidSvg;
    var cleaned = try std.ArrayList(u8).initCapacity(allocator, svg.len - (close + 7 - start));
    defer cleaned.deinit(allocator);
    try cleaned.appendSlice(allocator, svg[0..start]);
    try cleaned.appendSlice(allocator, svg[close + 7 ..]);
    return allocator.dupeZ(u8, cleaned.items);
}

fn renderForTest(source: []const u8, foreground: *const [3]u8, background: *const [3]u8) !*RenderResult {
    if (texInit() != @intFromEnum(Status.ok)) return error.InitializationFailed;
    return texRender(source.ptr, @intCast(source.len), 0, foreground, background) orelse error.OutOfMemory;
}

test "render result contains bounded opaque RGBA pixels" {
    const foreground = [3]u8{ 255, 255, 255 };
    const background = [3]u8{ 1, 2, 3 };
    const result = try renderForTest("x", &foreground, &background);
    defer texResultDestroy(result);

    try std.testing.expectEqual(@as(u32, @intFromEnum(Status.ok)), texResultStatus(result));
    try std.testing.expect(result.width > 0 and result.width <= dimension_max);
    try std.testing.expect(result.height > 0 and result.height <= dimension_max);
    const expected_length = result.width * result.height * channels;
    try std.testing.expectEqual(expected_length, texResultPixelsLength(result));
    try std.testing.expectEqual(@as(usize, expected_length), result.pixels.len);
    try std.testing.expect(texResultPixels(result) != null);

    var contains_foreground = false;
    var offset: usize = 0;
    while (offset < result.pixels.len) : (offset += channels) {
        try std.testing.expectEqual(@as(u8, 255), result.pixels[offset + 3]);
        contains_foreground = contains_foreground or !std.mem.eql(u8, result.pixels[offset .. offset + 3], &background);
    }
    try std.testing.expect(contains_foreground);
}

test "texResultDestroy frees successful result pixels" {
    const foreground = [3]u8{ 255, 255, 255 };
    const background = [3]u8{ 0, 0, 0 };
    const allocations_before = test_pixel_allocations;
    const result = try renderForTest("y", &foreground, &background);
    try std.testing.expectEqual(allocations_before + 1, test_pixel_allocations);
    texResultDestroy(result);
    try std.testing.expectEqual(allocations_before, test_pixel_allocations);
}

test "render frees result pixels after a partial failure" {
    const foreground = [3]u8{ 255, 255, 255 };
    const background = [3]u8{ 0, 0, 0 };
    const allocations_before = test_pixel_allocations;
    test_fail_after_pixel_allocation = true;
    defer test_fail_after_pixel_allocation = false;
    const result = try renderForTest("z", &foreground, &background);
    defer texResultDestroy(result);

    try std.testing.expectEqual(@as(u32, @intFromEnum(Status.out_of_memory)), texResultStatus(result));
    try std.testing.expectEqual(allocations_before, test_pixel_allocations);
    try std.testing.expectEqual(@as(u32, 0), texResultPixelsLength(result));
    try std.testing.expect(texResultPixels(result) == null);
}

test "maximum result dimensions and ABI pixel length are bounded" {
    try std.testing.expect(dimension_max <= std.math.maxInt(u32));
    const pixel_count_max = try std.math.mul(u32, dimension_max, dimension_max);
    const pixel_length_max = try std.math.mul(u32, pixel_count_max, channels);
    try std.testing.expect(pixel_length_max <= std.math.maxInt(u32));
}
